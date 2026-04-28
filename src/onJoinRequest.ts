import { GameStateReader, GameStatus, gs } from '@acosgames/framework';
import storage from './storage.js';
import { protoEncode } from 'acos-json-encoder';
import rabbitmq from 'shared/services/rabbitmq.js';
import r from 'shared/services/room.js';

class JoinAction {
    async onJoinResponse(room_slug: string, game: GameStateReader): Promise<boolean> {
        try {
            // let gstate = gs(gamestate);
            if (!game) return false;

            let joinEvents = game.eventsByType('join');
            // joinEvents = (gamestate.room?.events ?? []).filter((e) => e.type === 'join');

            // let ids = joinEvents?.[0]?.payload;
            // if (!Array.isArray(ids)) ids = [ids];
            for (const {type, payload} of joinEvents) {
                let player = game.player(payload); 
                if (!player) { 
                    console.error("[onJoinResponse] missing player for: ", payload);
                    continue;
                }
                let shortid = player.shortid;
                let ws = storage.getUser(shortid);
                if (!ws) {
                    console.error("[onJoinResponse] missing websocket for: ", shortid);
                    return false;
                }

                await this.onJoined(ws, room_slug);
            }

            return true;
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    async onJoined(ws: any, room_slug: string, roomState?: any): Promise<boolean> {
        let shortid = ws.user.shortid;
        roomState = roomState || (await storage.getRoomState(room_slug, ws.user.shortid));

        if (roomState) {
            ws.subscribe(room_slug);

            let room = await storage.getRoomMeta(room_slug);
            let msg = {
                type: "joined",
                payload: {
                    gamestate: roomState,
                    room,
                }
            };

            console.log(
                "User joined game: ",
                ws.user.shortid,
                ws.user.displayname,
                "room_slug:",
                room_slug
            );
            ws.send(protoEncode(msg), true, false);
            return true;
        } else {
            console.error("[onJoined] Missing roomState for join response: ", shortid, room_slug);
            this.sendResponse(ws, "notexist", room_slug);
            let meta = await storage.getRoomMeta(room_slug);
            storage.cleanupRoom(meta);
            return false;
        }
    }

    sendResponse(ws: any, type: string, room_slug: string): void {
        let msg = { type, payload: { room_slug } };
        ws.send(protoEncode(msg), true, false);
    }

    async onJoinGame(ws: any, action: any): Promise<null> {
        if (ws && ws.user && ws.user.shortid) {
            let activeRooms = await this.getPlayerActiveRooms(ws);
            if (activeRooms) return null;
        } else {
            console.error("ws failed: ", ws);
            return null;
        }

        if (!ws.user || !ws.user.shortid || !ws.user.displayname) return null;

        try {
            let captain = ws.user.shortid;
            let partyid = action?.payload?.partyid;
            let queues = action?.payload?.queues;
            let owner = action?.payload?.owner;
            let players = await this.generateQueuePlayers(ws, partyid);

            let approvedQueues = await this.validateQueues(ws, players, queues);
            if (approvedQueues.length === 0) return null;

            let msg = {
                captain,
                partyid,
                players,
                queues: approvedQueues,
                owner,
            };
            await rabbitmq.publishQueue("joinQueue", msg);
        } catch (e) {
            console.error(e);
        }

        return null;
    }

    async onJoinQueues(ws: any, action: any): Promise<null> {
        if (ws && ws.user && ws.user.shortid) {
            let activeRooms = await this.getPlayerActiveRooms(ws);
            if (activeRooms) return null;
        } else {
            console.error("ws failed: ", ws);
            return null;
        }

        // @ts-ignore - preserves original JS behaviour (operator precedence bug in source)
        if (!ws.loggedIn === "LURKER") return null;

        try {
            let captain = ws.user.shortid;
            let partyid = action?.payload?.partyid;
            let queues = action?.payload?.queues;
            let owner = action?.payload?.owner;
            let players = await this.generateQueuePlayers(ws, partyid);

            let approvedQueues = await this.validateQueues(ws, players, queues);
            if (approvedQueues.length === 0) return null;

            let msg = {
                captain,
                partyid,
                players,
                queues: approvedQueues,
                owner,
            };
            await rabbitmq.publishQueue("joinQueue", msg);
        } catch (e) {
            console.error(e);
        }

        return null;
    }

    async generateQueuePlayers(ws: any, partyid: string): Promise<any> {
        let captain = ws?.user?.shortid;
        let players = null;
        if (partyid) {
            let team = await storage.getParty(partyid);

            if (captain !== team.captain) {
                return null;
            }

            players = team.players;
        } else {
            players = [
                {
                    shortid: captain,
                    displayname: ws.user.displayname,
                    portraitid: ws.user.portraitid || 1,
                    countrycode: ws.user.countrycode || "US",
                },
            ];
        }
        return players;
    }

    async validateQueues(ws: any, players: any[], queues: any[]): Promise<any[]> {
        let approvedQueues: any[] = [];
        for (let queue of queues) {
            let gameinfo = await storage.getGameInfo(queue.game_slug);
            let min = gameinfo.minplayers;
            let max = gameinfo.maxplayers;

            if (players.length > min) {
                continue;
            }

            if (max === 1) {
                await this.createGameAndJoinSinglePlayer(ws, queue);
                return [];
            }

            approvedQueues.push(queue);
        }
        return approvedQueues;
    }

    async createGameAndJoinSinglePlayer(ws: any, queue: any): Promise<void> {
        let shortid = ws.user.shortid;
        let displayname = ws.user.displayname;
        let countrycode = ws.user.countrycode;
        let portraitid = ws.user.portraitid;
        let game_slug = queue.game_slug;
        let mode = queue.mode;

        let id = -1;

        let room = await r.createRoom(shortid, 0, game_slug, mode, null) as any;
        if( !room || !room.room_slug ) {
            console.error("Failed to create room for single player game: ", game_slug);
            return;
        }
        let room_slug = room.room_slug;

        let msg = {
            type: "join",
            user: { id, shortid, displayname, countrycode, portraitid },
            room_slug,
        };

        let actions = [msg];

        await this.sendCreateGameRequest(game_slug, room_slug, actions, shortid);
    }

    async sendCreateGameRequest(game_slug: string, room_slug: string, actions: any[], shortid: string): Promise<void> {
        try {
            await rabbitmq.publishQueue("loadGame", {
                game_slug,
                room_slug,
                actions,
            });

            console.log("Assign: ", shortid, room_slug);
            await r.assignPlayerRoom(shortid, room_slug, game_slug);
        } catch (e) {
            console.error(e);
        }
    }

    async onLeaveQueue(ws: any): Promise<null> {
        try {
            let msg = { user: { shortid: ws.user.shortid } };
            await rabbitmq.publishQueue("leaveQueue", msg);
        } catch (e) {
            console.error(e);
        }
        return null;
    }

    async isPlayerInRoom(ws: any): Promise<boolean> {
        let rooms = await storage.getPlayerRooms(ws.user.shortid);
        return rooms.length > 0;
    }

    async getPlayerActiveRooms(ws: any): Promise<any> {
        let rooms = await storage.getPlayerRooms(ws.user.shortid);
        if (rooms.length === 0) return false;

        let activeRooms: any[] = [];

        console.log("User " + ws.user.shortid + " has " + rooms.length + " rooms.");
        for (var i = 0; i < rooms.length; i++) {
            let roomState = await storage.getRoomState(rooms[i].room_slug, ws.user.shortid);
            if(!roomState) {
                console.error("Missing room state for: ", rooms[i].room_slug);
                storage.cleanupRoom(rooms[i]);
                continue;
            }
            let game = gs(roomState);
            if (
                !roomState ||
                game.status === GameStatus.gameover ||
                game.status === GameStatus.gamecancelled ||
                game.status === GameStatus.gameerror
            ) {
                storage.cleanupRoom(rooms[i]);
                continue;
            }

            ws.subscribe(rooms[i].room_slug);

            activeRooms.push({ gamestate: roomState, room: rooms[i] });
        }

        if (activeRooms.length === 0) return false;

        return activeRooms;
    }
}

export default new JoinAction();
