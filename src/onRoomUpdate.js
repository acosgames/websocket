const { encode } = require('fsg-shared/util/encoder');

const storage = require('./storage');

const mq = require('fsg-shared/services/rabbitmq');
const redis = require('fsg-shared/services/redis');
const JoinAction = require('./onJoin');


class RoomUpdate {
    constructor() {

        this.setup();
    }

    setup() {
        if (!mq.isActive() || !redis.isActive) {
            setTimeout(this.setup.bind(this), 2000);
            return;
        }

        mq.subscribe('ws', 'onRoomUpdate', this.onRoomUpdate.bind(this));
        mq.subscribe('ws', 'onJoinResponse', JoinAction.onJoinResponse);
    }


    async onRoomUpdate(msg) {
        let room_slug = msg.meta.room_slug;
        if (!room_slug)
            return true;

        try {
            let savedMeta = msg.meta;
            delete msg['meta'];

            if (msg.payload.next)
                this.processTimelimit(msg.payload.next);

            let playerList = Object.keys(msg.payload.players);

            let encoded = encode(msg);
            let app = storage.getWSApp();
            app.publish(room_slug, encoded, true, false)

            msg.meta = savedMeta;
            storage.setRoomState(room_slug, msg);

            setTimeout(() => {
                if (msg.payload.kick) {
                    this.kickPlayers(msg);
                }

                if (msg.type == 'finish' || playerList.length == 0 || msg.payload.killGame) {
                    this.killGameRoom(msg);
                    return true;
                }
            }, 1000)


            return true;
        }
        catch (e) {
            console.error(e);
        }
        return false;
    }



    async kickPlayers(msg) {
        let game = msg.payload;
        let players = game.kick;
        for (var id = 0; i < players.length; id++) {
            if (game.players && game.players[id])
                delete game.players[id];
        }

        for (var id = 0; i < players.length; id++) {
            let ws = await storage.getUser(id);
            if (!ws)
                continue;

            ws.unsubscribe(msg.meta.room_slug);

            let response = { type: 'kicked', meta: { room_slug: msg.meta.room_slug }, payload: msg.payload }
            let encoded = encode(response);
            ws.send(encoded, true, false);
        }
    }

    async killGameRoom(msg) {

        let game = msg.payload;
        if (!game || !game.players)
            return;

        for (var id in game.players) {
            let ws = storage.getUser(id);
            if (!ws)
                continue;

            ws.unsubscribe(msg.meta.room_slug);
            // let response = { type: 'finish', payload: msg.payload }
            // let encoded = encode(response);
            // this.users[id].send(encoded, true, false);
            // this.users[id].disconnect();
        }

        let room_slug = msg.meta.room_slug;
        if (!room_slug) {
            console.error("Kill Game Room: Error: Missing room_slug");
            return;
        }

        storage.cleanupRoom(room_slug);
    }

    async processTimelimit(next) {
        let seconds = next.timelimit;
        seconds = Math.min(60, Math.max(10, seconds));

        let now = (new Date()).getTime();
        let deadline = now + (seconds * 1000);
        next.deadline = deadline;
    }
}

module.exports = new RoomUpdate();