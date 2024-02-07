const storage = require('./storage');
const { encode } = require('acos-json-encoder');
const rabbitmq = require('shared/services/rabbitmq');
const r = require('shared/services/room');
const room = require('shared/services/room');

class JoinAction {

    async onJoinResponse(room_slug, gamestate) {
        try {
            if (!gamestate?.events?.join)
                return false;

            let ids = gamestate.events.join;
            for (const id of ids) {
                let ws = await storage.getUser(id);
                if (!ws) {
                    console.error("[onJoinResponse] missing websocket for: ", id);
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

        let id = ws.user.shortid;
        roomState = roomState || await storage.getRoomState(room_slug, ws.user.shortid);

        if (roomState) {
            ws.subscribe(room_slug);

            let room = await storage.getRoomMeta(room_slug);
            let msg = {
                type: 'joined',
                payload: roomState,
                room,
            };

            console.log("User joined game: ", ws.user.shortid, ws.user.name, 'room_slug:', room_slug);
            ws.send(encode(msg), true, false);
            return true;
        } else {
            console.error("[onJoined] Missing roomState for join response: ", id, room_slug);
            this.sendResponse(ws, 'notexist', room_slug);
            //await r.removePlayerRoom(ws.user.shortid, room_slug);
            let meta = await storage.getRoomMeta(room_slug);
            storage.cleanupRoom(meta);
            return false;
        }
    }

    async onJoinGame(ws, action) {

        if (ws && ws.user && ws.user.shortid) {
            //User is already in a room
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
            let teamid = action?.payload?.teamid;
            let queues = action?.payload?.queues;
            let owner = action?.payload?.owner;
            let players = await this.generateQueuePlayers(ws, teamid);

            //check if game is single player or game has space for the amount of players 
            let approvedQueues = await this.validateQueues(ws, players, queues);
            if (approvedQueues.length == 0)
                return null;

            let msg = { captain, teamid, players, queues: approvedQueues, owner }
            await rabbitmq.publishQueue('joinQueue', msg);
        }
        catch (e) {
            console.error(e);
        }

        return null;
    }

    async onJoinQueues(ws, action) {

        // var playerCount = storage.getPlayerCount();

        if (ws && ws.user && ws.user.shortid) {
            let activeRooms = await this.getPlayerActiveRooms(ws);
            if (activeRooms)
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
            let players = await this.generateQueuePlayers(ws, teamid);

            //check if game is single player or game has space for the amount of players 
            let approvedQueues = await this.validateQueues(ws, players, queues);
            if (approvedQueues.length == 0)
                return null;

            let msg = { captain, teamid, players, queues: approvedQueues, owner }
            await rabbitmq.publishQueue('joinQueue', msg);
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

            if (captain != team.captain) {
                return null;
            }

            players = team.players;
        } else {
            players = [{ shortid: captain, displayname: ws.user.displayname, portraitid: ws.user.portraitid || 1, countrycode: ws.user.countrycode || 'US' }];
        }
        return players;
    }

    async validateQueues(ws, players, queues) {
        let approvedQueues = [];
        for (let queue of queues) {
            let gameinfo = await storage.getGameInfo(queue.game_slug);
            let min = gameinfo.minplayers;
            let max = gameinfo.maxplayers;
            queue.preview_image = gameinfo.preview_images;
            queue.name = gameinfo.name;

            if (players.length > min) {
                continue;
            }

            if (max == 1) {
                await this.createGameAndJoinSinglePlayer(ws, queue)
                return [];
            }

            approvedQueues.push(queue);
        }
        return approvedQueues;
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
        await this.sendCreateGameRequest(game_slug, room_slug, room.room_id, actions, shortid)
    }

    async sendCreateGameRequest(game_slug, room_slug, room_id, actions, shortid) {
        try {

            //forward to gameserver
            await rabbitmq.publishQueue('loadGame', { game_slug, room_slug, actions });

            //save player room in database
            console.log("Assign: ", shortid, room_id);
            await r.assignPlayerRoom(shortid, room_id, game_slug);
        }
        catch (e) {
            console.error(e);
        }
    }

    async onLeaveQueue(ws) {
        try {
            //forward to matchmaker
            let msg = { user: { shortid: ws.user.shortid } }
            await rabbitmq.publishQueue('leaveQueue', msg);
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
        if (rooms.length == 0)
            return false;


        let activeRooms = [];

        console.log("User " + ws.user.shortid + " has " + rooms.length + " rooms.");
        for (var i = 0; i < rooms.length; i++) {
            let roomState = await storage.getRoomState(rooms[i].room_slug, ws.user.shortid);
            if (!roomState || roomState?.events?.gameover) {
                storage.cleanupRoom(rooms[i]);
                continue;
            }

            ws.subscribe(rooms[i].room_slug);

            rooms[i].gamestate = roomState;
            activeRooms.push(rooms[i]);
        }

        if (activeRooms.length == 0)
            return false;

        return activeRooms;
    }
}

module.exports = new JoinAction();