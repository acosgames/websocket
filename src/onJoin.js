const storage = require('./storage');
const { encode } = require('fsg-shared/util/encoder');
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
        let inRoom = await this.checkIsInRoom(ws, room_slug);
        if (!inRoom) {
            let msg = {
                type: 'notexist',
                payload: {},
                room_slug
            };

            // console.log('[onJoined] Sending message: ', msg.payload);
            let encoded = encode(msg);
            ws.send(encoded, true, false);
            return null;
        }

        this.subscribeToRoom(ws, room_slug);
        return null;
    }

    async onJoin(ws, action) {
        let isBeta = action.payload.beta || false;
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
            room = await r.findAnyRoom(ws.user, game_slug, isBeta);
            if (!room)
                return null;
        }

        console.log("Found room: ", room.game_slug, room.room_slug, room.version);


        return await this.onPreJoinRoom(ws, action, room);
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
            let response = { type: 'joining', room_slug: room.room_slug, beta: room.istest, payload: {} }
            ws.send(encode(response), true, false);
        }, 0);

        action.room_slug = room.room_slug;
        return action;
    }




    async pendingJoin(ws, room) {
        if (!ws.pending)
            ws.pending = {};
        ws.pending[room.room_slug] = true;
    }

    async onJoinResponse(room_slug, gamestate) {
        try {
            // let playerList = Object.keys(action.payload.players);
            // let savedRoom = await storage.getRoomState(room_slug);

            if (gamestate && gamestate.events && gamestate.events.join) {
                let id = gamestate.events.join.id;
                let ws = await storage.getUser(id);
                if (!ws) {
                    console.error("[onJoinResponse] missing websocket for: ", id);
                    return false;
                }

                let pending = ws.pending[room_slug];
                if (!pending) {
                    console.error("[onJoinResponse] missing pending for: ", id, room_slug);
                }
                else {
                    delete ws.pending[room_slug];
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

    async onJoined(ws, room_slug, roomState) {
        let id = ws.user.id;

        // console.log("[onJoined] Subscribing and Sending to client.", id, room_slug);
        ws.subscribe(room_slug);
        roomState = roomState || await storage.getRoomState(room_slug);


        if (roomState && roomState.players[ws.user.shortid]) {

            let room = await storage.getRoomMeta(room_slug);

            let msg = {
                type: 'joined',
                payload: cloneObj(roomState),
                beta: room.istest,
                room_slug
            };

            // console.log('[onJoined] Sending message: ', msg.payload);
            let encoded = encode(msg);
            ws.send(encoded, true, false);
            return true;
        } else {
            console.error("[onJoined] Missing roomState for join response: ", id, room_slug);
            await r.removePlayerRoom(ws.user.shortid, room_slug);
            return false;
        }
    }


    async onJoinResponse2(msg) {
        try {
            console.log("Join Response: ", msg);
            if (!msg.payload.id)
                return true;

            let id = msg.payload.id;
            let room_slug = msg.payload.room_slug;

            let ws = await storage.getUser(id);
            if (!ws) {
                console.error("[onJoinResponse] missing websocket for: ", id);
                return true;
            }

            let pending = ws.pending[room_slug];
            if (!pending) {
                console.error("[onJoinResponse] missing pending for: ", id, room_slug);
                //return true;
            }
            else {
                delete ws.pending[room_slug];
            }



            if (msg.type == 'join') {
                await this.onJoined(ws, room_slug);

                return true;
            }

            if (msg.type == 'full') {
                let response = { type: 'gamefull', payload: { room_slug } };
                ws.send(encode(response), true, false);
                return true;
            }

            let response = { type: 'gameinvalid', payload: { room_slug } };
            ws.send(encode(response), true, false);
            return true
        }
        catch (e) {
            console.error(e);
            return false
        }

    }
}

module.exports = new JoinAction();


