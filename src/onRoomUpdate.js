const { encode } = require('fsg-shared/util/encoder');

const storage = require('./storage');

const mq = require('fsg-shared/services/rabbitmq');
const redis = require('fsg-shared/services/redis');
const JoinAction = require('./onJoin');
const profiler = require('fsg-shared/util/profiler');
const delta = require('fsg-shared/util/delta');
const r = require('fsg-shared/services/room');

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
        mq.subscribe('ws', 'onJoinResponse', JoinAction.onJoinResponse.bind(JoinAction));
    }


    async onRoomUpdate(msg) {
        // console.log('onRoomUpdate: ', msg);
        let room_slug = msg.room_slug;
        if (!room_slug)
            return true;

        try {

            let previousGamestate = await storage.getRoomState(room_slug) || {};
            // console.log("Previous: ", previousGamestate.players);
            let gamestate = delta.merge(previousGamestate, msg.payload);
            let playerList = Object.keys(gamestate.players);
            console.log("Delta: ", msg);
            // console.log("Updated Game: ", gamestate);

            //remove private variables and send individually to palyers
            let copy = JSON.parse(JSON.stringify(msg));
            let hiddenState = delta.hidden(copy.payload.state);
            let hiddenPlayers = delta.hidden(copy.payload.players);

            storage.setRoomState(room_slug, gamestate);

            if (msg.type == 'join') {
                await JoinAction.onJoinResponse(copy);
            }


            let app = storage.getWSApp();




            if (hiddenPlayers)
                for (var id in hiddenPlayers) {

                    let ws = await storage.getUser(id);
                    if (!ws)
                        continue;

                    let privateMsg = {
                        type: 'private',
                        room_slug,
                        payload: hiddenPlayers[id]
                    }
                    let encodedPrivate = encode(privateMsg);
                    ws.send(encodedPrivate);
                }


            let isGameover = copy.type == 'finish' || (gamestate.events && gamestate.events.gameover);
            if (copy.type == 'error' || isGameover || playerList.length == 0) {
                if (isGameover)
                    this.updatePlayerRatings(copy);

                setTimeout(() => {
                    this.killGameRoom(copy);
                }, 1000)
                //return true;
            }

            if (copy.payload.kick) {
                this.kickPlayers(copy);
            }

            // setTimeout(() => {
            let encoded = encode(copy);
            app.publish(room_slug, encoded, true, false)
            // }, 200)

            // profiler.EndTime('ActionUpdateLoop');
            // console.timeEnd('onRoomUpdate');
            return true;
        }
        catch (e) {
            console.error(e);
        }
        return false;
    }

    async kickPlayers(msg) {
        let game = msg.payload;
        let room_slug = msg.room_slug;
        let players = game.kick;
        for (var id = 0; i < players.length; id++) {
            if (game.players && game.players[id])
                delete game.players[id];
        }

        for (var id = 0; i < players.length; id++) {
            let ws = await storage.getUser(id);
            if (!ws)
                continue;


            ws.unsubscribe(room_slug);
            let response = { type: 'kicked', room_slug, payload: game }
            let encoded = encode(response);
            ws.send(encoded, true, false);
        }
    }

    async updatePlayerRatings(msg) {
        let game = msg.payload;
        let room_slug = msg.room_slug;
        if (!game || !game.players)
            return;
        let meta = await storage.getRoomMeta(room_slug);


        let playerRatings = [];
        for (var id in game.players) {
            let ws = storage.getUser(id);
            if (!ws)
                continue;

            let player = game.players[id];
            let playerRating = {
                mu: player.mu,
                sigma: player.sigma,
                rating: player.rating
            };
            playerRatings.push(playerRating)
            r.setPlayerRating(id, meta.game_slug, playerRating);

            delete player.sigma;
            delete player.mu;
        }
    }

    async killGameRoom(msg) {

        if (!msg.room_slug) {
            console.error("[killGameRoom] Error: Missing room_slug");
            return;
        }

        storage.cleanupRoom(msg.room_slug);
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