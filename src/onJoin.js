const storage = require('./storage');
const { encode } = require('fsg-shared/util/encoder');
const rabbitmq = require('fsg-shared/services/rabbitmq');
const r = require('fsg-shared/services/room');

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
            this.sendResponse(ws, 'notexist', room_slug);
            return null;
        }

        let roomMeta = await storage.getRoomMeta(room_slug);
        if (!roomMeta) {
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

            return await this.onPreJoinRoom(ws, action, roomMeta);
        }

        this.subscribeToRoom(ws, room_slug);
        return null;
    }

    async onJoinGame(ws, action) {
        let mode = action.payload.mode || 'rank';
        if (mode != 'experimental' && mode != 'rank') {
            mode = 'rank'
        }

        let game_slug = action.payload.game_slug;

        try {
            let msg = {
                user: {
                    id: ws.user.shortid,
                    name: ws.user.displayname
                },
                game_slug,
                mode
            }

            await rabbitmq.publishQueue('joinQueue', msg);

            this.pendingJoin(ws, game_slug + mode);

            //tell user they have joined the queue
            let response = { type: 'queue', game_slug, mode }
            ws.send(encode(response), true, false);
        }
        catch (e) {
            console.error(e);
        }

        return null;
    }


    async onJoinGame2(ws, action) {
        let mode = action.payload.mode || 'rank';
        if (mode != 'experimental' && mode != 'rank') {
            mode = 'rank'
        }

        let game_slug = action.payload.game_slug;

        let room = null;
        let rooms = await storage.getPlayerRoomsByGame(action.user.id, game_slug);
        // let rooms = await r.findPlayerRoom(action.user.id, game_slug);
        // let playerRating = await r.findPlayerRating(action.user.id, game_slug);

        if (!ws.user.ratings) {
            ws.user.ratings = {};
        }
        //ws.user.ratings[game_slug] = playerRating.rating;
        if (rooms && rooms.length > 0) {
            console.log(rooms);
            room = rooms[0];
            let inRoom = await this.checkIsInRoom(ws, room.room_slug);
            if (inRoom) {
                this.subscribeToRoom(ws, room.room_slug);
            }
            return null;
        }
        else {
            room = await r.findAnyRoom(ws.user, game_slug, mode);
            if (!room)
                return null;
        }

        console.log("Found room: ", room.game_slug, room.room_slug, room.version);


        return await this.onPreJoinRoom(ws, action, room);
    }


    async onPreJoinRoom(ws, action, room) {

        let room_slug = room.room_slug;
        let inRoom = await this.checkIsInRoom(ws, room_slug);
        if (inRoom) {
            this.subscribeToRoom(ws, room_slug);
            return null;
        }

        //track user who is pending a join 
        this.pendingJoin(ws, room);

        //these are used by the gameserver to add the user to specific room
        action.user.name = ws.user.displayname

        if (!room) {
            let response = { type: 'retry', payload: { type: action.type } }
            ws.send(encode(response), true, false);
            return null;
        }

        ws.subscribe(room.room_slug);
        setTimeout(() => {
            let response = { type: 'joining', room_slug: room.room_slug, experimental: room.istest, payload: {} }
            ws.send(encode(response), true, false);
        }, 0);

        action.room_slug = room.room_slug;
        return action;
    }

    async onJoinResponse(room_slug, gamestate) {
        try {
            // let playerList = Object.keys(action.payload.players);
            // let savedRoom = await storage.getRoomState(room_slug);

            if (gamestate && gamestate.events && gamestate.events.join) {
                let id = gamestate.events.join.id;
                let ws = await storage.getUser(id);

                let roomMeta = await storage.getRoomMeta(room_slug);
                if (!roomMeta)
                    return false;

                if (!ws) {
                    console.error("[onJoinResponse] missing websocket for: ", id);

                    // let action = { type: 'leave', room_slug }
                    // action.user = { id }
                    // await rabbitmq.publishQueue(roomMeta.game_slug, action);

                    return false;
                }

                let key = roomMeta.game_slug + roomMeta.mode;
                let pending = ws.pending[key];
                if (!pending) {
                    console.error("[onJoinResponse] missing pending for: ", id, room_slug);
                }
                else {
                    delete ws.pending[key];
                }

                await this.onJoined(ws, room_slug);
            }
            // for (var i = 0; i < playerList.length; i++) {
            //     let id = playerList[i];
            //     if (!(id in savedRoom.players)) {

            //     }
            // }
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
                    id: ws.user.shortid
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
        let id = ws.user.id;

        // console.log("[onJoined] Subscribing and Sending to client.", id, room_slug);
        ws.subscribe(room_slug);
        roomState = roomState || await storage.getRoomState(room_slug);

        if (roomState) {

            let room = await storage.getRoomMeta(room_slug);
            let mode = r.getGameModeName(room.mode);
            let game_slug = room.game_slug;
            let gameid = room.gameid;
            let version = room.version;
            let msg = {
                type: 'joined',
                payload: cloneObj(roomState),
                mode,
                room_slug,
                game_slug,
                gameid,
                version
            };

            // console.log('[onJoined] Sending message: ', msg.payload);
            let encoded = encode(msg);
            ws.send(encoded, true, false);
            return true;
        } else {
            console.error("[onJoined] Missing roomState for join response: ", id, room_slug);
            this.sendResponse(ws, 'notexist', room_slug);
            //await r.removePlayerRoom(ws.user.shortid, room_slug);
            r.deleteRoom(room_slug);
            return false;
        }
    }


    sendResponse(ws, type, room_slug) {
        let msg = {
            type,
            room_slug
        };
        let encoded = encode(msg);
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
        ws.subscribe(room_slug);
        roomState = roomState || await storage.getRoomState(room_slug);
        setTimeout(() => {
            this.onJoined(ws, room_slug, roomState);
        }, 0);
    }

    async pendingJoin(ws, queue) {
        if (!ws.pending)
            ws.pending = {};
        ws.pending[queue] = true;
    }



}

module.exports = new JoinAction();


