import storage from './storage.js';
import { protoEncode } from 'acos-json-encoder';
import rabbitmq from 'shared/services/rabbitmq.js';
import r from 'shared/services/room.js';
class JoinAction {
    async onJoinResponse(room_slug, gamestate) {
        try {
            if (!gamestate?.room?.events?.join)
                return false;
            let ids = gamestate.room?.events.join;
            if (!Array.isArray(ids))
                ids = [ids];
            for (const shortid of ids) {
                let ws = storage.getUser(shortid);
                if (!ws) {
                    console.error("[onJoinResponse] missing websocket for: ", shortid);
                    return false;
                }
                await this.onJoined(ws, room_slug);
            }
            return true;
        }
        catch (e) {
            console.error(e);
            return false;
        }
    }
    async onJoined(ws, room_slug, roomState) {
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
            console.log("User joined game: ", ws.user.shortid, ws.user.displayname, "room_slug:", room_slug);
            ws.send(protoEncode(msg), true, false);
            return true;
        }
        else {
            console.error("[onJoined] Missing roomState for join response: ", shortid, room_slug);
            this.sendResponse(ws, "notexist", room_slug);
            let meta = await storage.getRoomMeta(room_slug);
            storage.cleanupRoom(meta);
            return false;
        }
    }
    sendResponse(ws, type, room_slug) {
        let msg = { type, payload: { room_slug } };
        ws.send(protoEncode(msg), true, false);
    }
    async onJoinGame(ws, action) {
        if (ws && ws.user && ws.user.shortid) {
            let activeRooms = await this.getPlayerActiveRooms(ws);
            if (activeRooms)
                return null;
        }
        else {
            console.error("ws failed: ", ws);
            return null;
        }
        if (!ws.user || !ws.user.shortid || !ws.user.displayname)
            return null;
        try {
            let captain = ws.user.shortid;
            let partyid = action?.payload?.partyid;
            let queues = action?.payload?.queues;
            let owner = action?.payload?.owner;
            let players = await this.generateQueuePlayers(ws, partyid);
            let approvedQueues = await this.validateQueues(ws, players, queues);
            if (approvedQueues.length === 0)
                return null;
            let msg = {
                captain,
                partyid,
                players,
                queues: approvedQueues,
                owner,
            };
            await rabbitmq.publishQueue("joinQueue", msg);
        }
        catch (e) {
            console.error(e);
        }
        return null;
    }
    async onJoinQueues(ws, action) {
        if (ws && ws.user && ws.user.shortid) {
            let activeRooms = await this.getPlayerActiveRooms(ws);
            if (activeRooms)
                return null;
        }
        else {
            console.error("ws failed: ", ws);
            return null;
        }
        // @ts-ignore - preserves original JS behaviour (operator precedence bug in source)
        if (!ws.loggedIn === "LURKER")
            return null;
        try {
            let captain = ws.user.shortid;
            let partyid = action?.payload?.partyid;
            let queues = action?.payload?.queues;
            let owner = action?.payload?.owner;
            let players = await this.generateQueuePlayers(ws, partyid);
            let approvedQueues = await this.validateQueues(ws, players, queues);
            if (approvedQueues.length === 0)
                return null;
            let msg = {
                captain,
                partyid,
                players,
                queues: approvedQueues,
                owner,
            };
            await rabbitmq.publishQueue("joinQueue", msg);
        }
        catch (e) {
            console.error(e);
        }
        return null;
    }
    async generateQueuePlayers(ws, partyid) {
        let captain = ws?.user?.shortid;
        let players = null;
        if (partyid) {
            let team = await storage.getParty(partyid);
            if (captain !== team.captain) {
                return null;
            }
            players = team.players;
        }
        else {
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
    async validateQueues(ws, players, queues) {
        let approvedQueues = [];
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
    async createGameAndJoinSinglePlayer(ws, queue) {
        let shortid = ws.user.shortid;
        let displayname = ws.user.displayname;
        let countrycode = ws.user.countrycode;
        let portraitid = ws.user.portraitid;
        let game_slug = queue.game_slug;
        let mode = queue.mode;
        let room = await r.createRoom(shortid, 0, game_slug, mode, null);
        if (!room || !room.room_slug) {
            console.error("Failed to create room for single player game: ", game_slug);
            return;
        }
        let room_slug = room.room_slug;
        let msg = {
            type: "join",
            user: { shortid, displayname, countrycode, portraitid },
            room_slug,
        };
        let actions = [msg];
        await this.sendCreateGameRequest(game_slug, room_slug, actions, shortid);
    }
    async sendCreateGameRequest(game_slug, room_slug, actions, shortid) {
        try {
            await rabbitmq.publishQueue("loadGame", {
                game_slug,
                room_slug,
                actions,
            });
            console.log("Assign: ", shortid, room_slug);
            await r.assignPlayerRoom(shortid, room_slug, game_slug);
        }
        catch (e) {
            console.error(e);
        }
    }
    async onLeaveQueue(ws) {
        try {
            let msg = { user: { shortid: ws.user.shortid } };
            await rabbitmq.publishQueue("leaveQueue", msg);
        }
        catch (e) {
            console.error(e);
        }
        return null;
    }
    async isPlayerInRoom(ws) {
        let rooms = await storage.getPlayerRooms(ws.user.shortid);
        return rooms.length > 0;
    }
    async getPlayerActiveRooms(ws) {
        let rooms = await storage.getPlayerRooms(ws.user.shortid);
        if (rooms.length === 0)
            return false;
        let activeRooms = [];
        console.log("User " + ws.user.shortid + " has " + rooms.length + " rooms.");
        for (var i = 0; i < rooms.length; i++) {
            let roomState = await storage.getRoomState(rooms[i].room_slug, ws.user.shortid);
            if (!roomState ||
                roomState?.room?.events?.gameover ||
                roomState?.room?.events?.gamecancelled ||
                roomState?.room?.events?.gameerror) {
                storage.cleanupRoom(rooms[i]);
                continue;
            }
            ws.subscribe(rooms[i].room_slug);
            activeRooms.push({ gamestate: roomState, room: rooms[i] });
        }
        if (activeRooms.length === 0)
            return false;
        return activeRooms;
    }
}
export default new JoinAction();
//# sourceMappingURL=onJoinRequest.js.map