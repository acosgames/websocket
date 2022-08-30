const storage = require('./storage');
const { encode } = require('shared/util/encoder');
const rabbitmq = require('shared/services/rabbitmq');
const r = require('shared/services/room');

function cloneObj(obj) {
    if (typeof obj === 'object')
        return JSON.parse(JSON.stringify(obj));
    return obj;
}

class JoinAction {

    async onJoinRoom(ws, action) {
        let room_slug = action.payload.room_slug;
        if (!room_slug)
            return null;


        let roomState = await storage.getRoomState(room_slug);
        if (!roomState) {
            storage.cleanupRoom(room_slug);
            this.sendResponse(ws, 'notexist', room_slug);
            return null;
        }

        if (roomState?.events?.gameover) {
            storage.cleanupRoom(room_slug);
            this.sendResponse(ws, 'notexist', room_slug);
            return null;
        }

        let roomMeta = await storage.getRoomMeta(room_slug);
        if (!roomMeta) {
            storage.cleanupRoom(room_slug);
            this.sendResponse(ws, 'notexist', room_slug);
            return null;
        }

        let inRoom = await this.checkIsInRoom(ws, room_slug);
        if (!inRoom) {
            let isFull = await this.checkIsRoomFull(room_slug);
            if (isFull) {
                this.sendResponse(ws, 'full', room_slug);
                return null;
            }

            //track user who is pending a join 
            // let key = ws.user.shortid + roomMeta.game_slug + roomMeta.mode;
            // this.pendingJoin(ws, key);

            return await this.onPreJoinRoom(ws, action, roomMeta);
        }

        let success = this.subscribeToRoom(ws, room_slug);
        if (!success) {

        }
        return null;
    }

    async onJoinQueues(ws, action) {

        var playerCount = storage.getPlayerCount();

        if (ws && ws.user && ws.user.shortid) {
            if (await this.checkInRoom(ws, action))
                return null;
        }
        else {
            console.error("ws failed: ", ws);
            return null;
        }


        if (!ws.loggedIn == 'LURKER')
            return null;

        try {

            let captain = ws.user.shortid;
            let teamid = action?.payload?.teamid;
            let queues = action?.payload?.queues;
            let owner = action?.payload?.owner;
            let players = null;
            if (teamid) {
                let team = await storage.getTeam(teamid);

                if (captain != team.captain) {
                    return null;
                }

                players = team.players;
            } else {
                players = [{ shortid: captain, displayname: ws.user.displayname }];
            }

            let approvedQueues = [];

            //check if game is single player
            for (let queue of queues) {
                let gameinfo = await storage.getGameInfo(queue.game_slug);
                let min = gameinfo.minplayers;
                let max = gameinfo.maxplayers;

                if (players.length > min) {
                    continue;
                }

                if (max == 1) {
                    await this.createGameAndJoinSinglePlayer(ws, queue)
                    return null;
                }

                approvedQueues.push(queue);

            }



            let msg = { captain, teamid, players, queues: approvedQueues, owner }
            await rabbitmq.publishQueue('joinQueue', msg);

            // this.pendingJoin(ws, game_slug + mode);

            // console.log("User " + ws.user.shortid + " joining " + queues.length + " queues.");
            // //tell user they have joined the queue
            // let response = { type: 'queue', queues, playerCount }
            // // console.log("onJoinGame 2");
            // ws.send(encode(response), true, false);
        }
        catch (e) {
            console.error(e);
        }

        return null;
    }


    async createGameAndJoinSinglePlayer(ws, queue) {

        let shortid = ws.user.shortid;
        let displayname = ws.user.displayname;
        let game_slug = queue.game_slug;
        let mode = queue.mode;

        //create room using the first player in lobby
        let room = await r.createRoom(shortid, 0, game_slug, mode);
        let room_slug = room.room_slug;

        let msg = {
            type: 'join',
            user: { id: shortid, displayname },
            room_slug
        }

        let actions = [msg];

        this.onLeaveQueue(ws);

        await this.sendJoinRequest(game_slug, room_slug, actions, shortid)
    }

    async sendJoinRequest(game_slug, room_slug, actions, shortid) {
        try {
            //tell our game server to load the game, if one doesn't exist already
            // let msg = {
            //     game_slug,
            //     room_slug
            // }
            // let key = game_slug + '/' + room_slug;
            await rabbitmq.publishQueue('loadGame', { game_slug, room_slug, actions });

            console.log("Assign: ", shortid, room_slug);
            await r.assignPlayerRoom(shortid, room_slug, game_slug);
        }
        catch (e) {
            console.error(e);
        }
    }


    async checkInRoom(ws) {
        let rooms = await storage.getPlayerRooms(ws.user.shortid);
        if (!rooms || rooms.length == 0)
            return false;

        let activeRooms = [];

        console.log("User " + ws.user.shortid + " has " + rooms.length + " rooms.");
        for (var i = 0; i < rooms.length; i++) {
            let roomState = await storage.getRoomState(rooms[i].room_slug, ws.user.shortid);
            if (!roomState) {
                storage.cleanupRoom(rooms[i].room_slug);
                continue;
            }
            this.subscribeToRoom(ws, rooms[i].room_slug, roomState);
            rooms[i].gamestate = roomState;
            activeRooms.push(rooms[i]);
        }

        var playerCount = storage.getPlayerCount();
        let response = { type: 'inrooms', payload: activeRooms, playerCount }
        // console.log("onJoinGame 1");
        ws.send(encode(response), true, false);


        return true;
    }

    async onJoinGame(ws, action) {

        var playerCount = storage.getPlayerCount();

        if (ws && ws.user && ws.user.shortid) {
            if (await this.checkInRoom(ws, action))
                return null;
        }
        else {
            console.error("ws failed: ", ws);
            return null;
        }

        if (!ws.user || !ws.user.shortid || !ws.user.displayname)
            return null;

        let mode = action.payload.mode || 'rank';
        if (mode != 'experimental' && mode != 'rank') {
            mode = 'rank'
        }


        try {
            let captain = ws.user.shortid;
            let teamid = action?.payload?.teamid;
            let queues = action?.payload?.queues;
            let owner = action?.payload?.owner;
            let players = null;
            if (teamid) {
                let team = await storage.getTeam(teamid);

                if (captain != team.captain) {
                    return null;
                }

                players = team.players;
            } else {
                players = [{ shortid: captain, displayname: ws.user.displayname }];
            }

            let approvedQueues = [];

            //check if game is single player
            for (let queue of queues) {
                let gameinfo = await storage.getGameInfo(queue.game_slug);
                let min = gameinfo.minplayers;
                let max = gameinfo.maxplayers;

                if (players.length > min) {
                    continue;
                }

                if (max == 1) {
                    await this.createGameAndJoinSinglePlayer(ws, queue)
                    return null;
                }

                approvedQueues.push(queue);
            }

            let msg = { captain, teamid, players, queues: approvedQueues, owner }
            await rabbitmq.publishQueue('joinQueue', msg);
        }
        catch (e) {
            console.error(e);
        }

        return null;
    }


    async onPreJoinRoom(ws, action, room) {

        let room_slug = room.room_slug;
        let inRoom = await this.checkIsInRoom(ws, room_slug);
        if (inRoom) {
            this.subscribeToRoom(ws, room_slug);
            return null;
        }



        //these are used by the gameserver to add the user to specific room
        action.user.name = ws.user.displayname

        if (!room) {
            let response = { type: 'retry', payload: { type: action.type } }
            console.log("onPreJoinRoom 1");
            ws.send(encode(response), true, false);
            return null;
        }

        ws.subscribe(room.room_slug);
        setTimeout(() => {
            let response = { type: 'joining', room_slug: room.room_slug, mode: room.mode, payload: {} }
            console.log("onPreJoinRoom 1");
            ws.send(encode(response), true, false);
        }, 0);

        action.room_slug = room.room_slug;
        return action;
    }

    async onJoinResponse(room_slug, gamestate) {
        try {
            if (gamestate && gamestate.events && gamestate.events.join) {

                let ids = gamestate.events.join;
                for (const id of ids) {
                    let ws = await storage.getUser(id);

                    let roomMeta = await storage.getRoomMeta(room_slug);
                    if (!roomMeta)
                        return false;

                    if (!ws) {
                        console.error("[onJoinResponse] missing websocket for: ", id);
                        return false;
                    }


                    await this.onJoined(ws, room_slug);
                }
            }

            return true;
        }
        catch (e) {
            console.error(e);
            return false;
        }
    }

    async onLeaveQueue(ws) {


        try {
            let msg = {
                user: {
                    shortid: ws.user.shortid
                }
            }

            await rabbitmq.publishQueue('leaveQueue', msg);

            //tell user they have joined the queue
            // let response = { type: 'leavequeue' }
            // if (ws && ws)
            //     ws.send(encode(response), true, false);
        }
        catch (e) {
            console.error(e);
        }

        return null;
    }
    async onJoined(ws, room_slug, roomState) {
        let id = ws.user.shortid;

        // console.log("[onJoined] Subscribing and Sending to client.", id, room_slug);

        roomState = roomState || await storage.getRoomState(room_slug, ws.user.shortid);

        if (roomState) {
            ws.subscribe(room_slug);

            let room = await storage.getRoomMeta(room_slug);
            // let mode = room.mode;
            // let game_slug = room.game_slug;
            // let gameid = room.gameid;
            // let version = room.version;

            // let game = await storage.getGameInfo(game_slug);

            let msg = {
                type: 'joined',
                payload: roomState,
                room,
            };

            // console.log('[onJoined] Sending message: ', msg.payload); 
            let encoded = encode(msg);
            console.log("onJoined 1");
            ws.send(encoded, true, false);
            return true;
        } else {
            console.error("[onJoined] Missing roomState for join response: ", id, room_slug);
            this.sendResponse(ws, 'notexist', room_slug);
            //await r.removePlayerRoom(ws.user.shortid, room_slug);
            storage.cleanupRoom(room_slug);
            return false;
        }
    }


    sendResponse(ws, type, room_slug) {
        let msg = {
            type,
            room_slug
        };
        let encoded = encode(msg);
        console.log("sendResponse ", type, room_slug);
        ws.send(encoded, true, false);
    }

    async checkIsRoomFull(room_slug) {
        if (!room_slug)
            return true;

        let result = await storage.getRoomCounts(room_slug);
        if (!result)
            return true;

        if (result.count >= result.max)
            return true;

        return false;
    }

    async checkIsInRoom(ws, room_slug) {
        if (!room_slug)
            return false;
        // let room = await storage.getRoomMeta(room_slug);
        let roomState = await storage.getRoomState(room_slug);
        if (!roomState || !roomState.players || !roomState.players[ws.user.shortid]) {
            return false;
        }

        return true;
        // return await this.onPreJoinRoom(ws, action, room);
    }

    async subscribeToRoom(ws, room_slug, roomState) {

        roomState = roomState || await storage.getRoomState(room_slug, ws.user.shortid);

        if (roomState) {
            console.log("Subscribing user: ", ws.user.shortid, room_slug);
            ws.subscribe(room_slug);

            setTimeout(() => {
                this.onJoined(ws, room_slug, roomState);
            }, 0);
            return true;
        } else {
            console.error("Room state does not exist.", ws.user.shortid, room_slug)
            return false;
        }
    }

    async pendingJoin(ws, key) {
        if (!ws.pending)
            ws.pending = {};
        ws.pending[key] = true;
    }



}

module.exports = new JoinAction();


