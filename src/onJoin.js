const storage = require('./storage');
const { encode } = require('fsg-shared/util/encoder');
const r = require('fsg-shared/services/room');

function cloneObj(obj) {
    if (typeof obj === 'object')
        return JSON.parse(JSON.stringify(obj));
    return obj;
}

class JoinAction {

    async onJoin(ws, action) {
        let isBeta = action.payload.beta;
        let game_slug = action.payload.game_slug;

        let room = null;
        let rooms = await r.findPlayerRoom(action.user.id, game_slug);
        if (rooms && rooms.length > 0) {
            console.log(rooms);
            room = rooms[0];
            this.onJoined(ws, room.room_slug);
            return null;
        }
        else {
            room = await r.findAnyRoom(game_slug, isBeta);
            if (!room)
                return null;
        }


        console.log("Found room: ", room.game_slug, room.room_slug, room.version);

        //save the room to cache
        // this.cacheRoom(room);

        //track user who is pending a join 
        this.pendingJoin(ws, room);

        //these are used by the gameserver to add the user to specific room
        action.user.name = ws.user.displayname

        if (!room) {
            let response = { type: 'retry', payload: { type: action.type } }
            ws.send(encode(response));
            return null;
        }

        action.meta = { room_slug: room.room_slug };
        return action;
    }

    async onJoined(ws, room_slug, roomState) {
        let id = ws.user.id;

        console.log("[onJoined] Subscribing and Sending to client.", id, room_slug);
        ws.subscribe(room_slug);
        roomState = roomState || await storage.getRoomState(room_slug);

        if (roomState) {
            let msg = {};
            msg.payload = cloneObj(roomState);
            msg.type = 'join';
            msg.meta = await storage.getRoomMeta(room_slug);
            console.log('[onJoined] Sending message: ', msg);
            let encoded = encode(msg);
            ws.send(encoded, true, false);
        } else {
            console.error("[onJoined] Missing roomState for join response: ", id, room_slug);
        }
    }

    async pendingJoin(ws, room) {
        if (!ws.pending)
            ws.pending = {};
        ws.pending[room.room_slug] = true;
    }

    async onJoinResponse(msg) {
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
                await this.onJoined(ws, room_slug, msg.payload);
                // console.log("[onJoinResponse] Subscribing and Sending to client.", id, room_slug);
                // ws.subscribe(room_slug);
                // let roomState = await storage.getRoomState(room_slug);

                // if (roomState) {
                //     msg = roomState;
                //     msg.type = 'join';
                //     msg.meta = await storage.getRoomMeta(room_slug);
                //     let encoded = encode(msg);
                //     ws.send(encoded, true, false);
                // } else {
                //     console.error("[onJoinResponse] Missing roomState for join response: ", id, room_slug);
                // }
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


