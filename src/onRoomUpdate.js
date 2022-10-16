const { encode } = require('shared/util/encoder');

const storage = require('./storage');

const mq = require('shared/services/rabbitmq');
const redis = require('shared/services/redis');
const JoinAction = require('./onJoinRequest');
const profiler = require('shared/util/profiler');
const delta = require('shared/util/delta');
const r = require('shared/services/room');

class RoomUpdate {
    constructor() {

        this.setup();
    }

    async setup() {
        if (!mq.isActive() || !redis.isActive) {
            setTimeout(this.setup.bind(this), 2000);
            return;
        }

        let qWS = await mq.findExistingQueue('ws');;
        await mq.subscribeQueue(qWS, this.onRoomUpdate.bind(this));

        setTimeout(async () => {
            let queueKey = await mq.subscribe('ws', 'onRoomUpdate', this.onRoomUpdate.bind(this), qWS);
        }, 3000)


        let qWS2 = await mq.findExistingQueue('queue');
        await mq.subscribeQueue(qWS2, this.onQueueUpdate.bind(this));

        setTimeout(async () => {
            let queueKey = await mq.subscribe('ws', 'onQueueUpdate', this.onQueueUpdate.bind(this), qWS2);
        }, 3000)

        //mq.subscribe('ws', 'onJoinResponse', JoinAction.onJoinResponse.bind(JoinAction));
    }

    async onQueueUpdate(msg) {

        if (!msg || !msg.type) {
            return true;
        }

        let party = msg.payload;

        if (msg.type == 'added') {
            if (party.players) {
                msg.type = 'addedQueue';
                let encoded = encode(msg);
                for (const player of party.players) {

                    let ws = storage.getUser(player.shortid);
                    if (!ws)
                        continue;

                    ws.send(encoded, true, false);
                }
            }

        }
        else if (msg.type == 'removed') {

            if (party.players) {
                let encoded = encode({ type: 'removedQueue' });
                for (const player in party.players) {

                    let ws = storage.getUser(player.shortid);
                    if (!ws)
                        continue;

                    ws.send(encoded, true, false);
                }
            }

        }


    }

    async onRoomUpdate(msg) {
        // profiler.StartTime('onRoomUpdate');
        let room_slug = msg.room_slug;
        if (!room_slug)
            return true;

        try {

            let previousGamestate = await storage.getRoomState(room_slug) || {};
            if (!previousGamestate) {
                this.killGameRoom({ room_slug });
                return true;
            }

            let action = msg.payload.action;
            if (action?.user)
                action.user = action.user.id;

            if (action?.user?.id)
                action.user = action.user.id;

            if (action && 'timeseq' in action)
                delete action.timeseq;

            if (action && 'timeleft' in action)
                delete action.timeleft;

            if (action && 'room_slug' in action)
                delete action.room_slug;

            msg.payload.action = action;

            previousGamestate.action = null;
            previousGamestate.events = null;

            // console.log("Previous: ", previousGamestate.players);
            let gamestate = delta.merge(previousGamestate, msg.payload);
            if (!gamestate) {
                this.killGameRoom({ room_slug });
                return true;
            }

            let playerList = Object.keys(gamestate.players || {});
            // console.log("Delta: ", msg);
            // console.log("Updated Game: ", gamestate);

            //remove private variables and send individually to palyers
            let copy = JSON.parse(JSON.stringify(msg));
            let hiddenState = delta.hidden(copy.payload.state);
            let hiddenPlayers = delta.hidden(copy.payload.players);




            storage.setRoomState(room_slug, gamestate);

            //skip doing any work if our websocket server doesn't have any of the users.
            // let usersFound = false;
            // for (var id of playerList) {
            //     let ws = await storage.getUser(id);
            //     if (!ws) {
            //         continue;
            //     }
            //     usersFound = true;
            //     break;
            // }

            // if (!usersFound && msg.type != 'join') {
            //     this.killGameRoom({ room_slug });
            //     return true;
            // }

            if (msg.type == 'join') {
                await JoinAction.onJoinResponse(room_slug, gamestate);
            }
            else if (msg.type == 'noshow') {
                // copy.events.noshow = true;
                // if (msg?.payload?.error)
                //     copy.error = msg.payload.error;
            }


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
                    console.log("Publishing Private [" + room_slug + "] with " + encodedPrivate.byteLength + ' bytes', JSON.stringify(privateMsg, null, 2));

                    ws.send(encodedPrivate, true, false);
                }


            let isGameover = copy.type == 'gameover' || (gamestate.events && gamestate.events.gameover);
            if (copy.type == 'noshow' || copy.type == 'error' || isGameover || playerList.length == 0) {
                // if (isGameover)
                //     this.updatePlayerRatings(copy);

                setTimeout(() => {
                    this.killGameRoom(copy);
                }, 1)
                //return true;
            }

            // if (copy.payload.kick) {
            //     this.kickPlayers(copy);
            // }

            // setTimeout(() => {
            let app = storage.getWSApp();
            let encoded = encode(copy);
            console.log("Publishing [" + room_slug + "] with " + encoded.byteLength + ' bytes', JSON.stringify(copy, null, 2));
            app.publish(room_slug, encoded, true, false)
            // }, 200)

            profiler.EndTime('ActionUpdateLoop');

            return true;
        }
        catch (e) {
            console.error(e);
        }
        return false;
    }

    // async kickPlayers(msg) {
    //     let game = msg.payload;
    //     let room_slug = msg.room_slug;
    //     let players = game.kick;
    //     for (var id = 0; i < players.length; id++) {
    //         if (game.players && game.players[id])
    //             delete game.players[id];
    //     }

    //     for (var id = 0; i < players.length; id++) {
    //         let ws = await storage.getUser(id);
    //         if (!ws)
    //             continue;


    //         ws.unsubscribe(room_slug);
    //         let response = { type: 'kicked', room_slug, payload: game }
    //         let encoded = encode(response);
    //         ws.send(encoded, true, false);
    //     }
    // }

    // async updatePlayerRatings(msg) {
    //     let game = msg.payload;
    //     let room_slug = msg.room_slug;
    //     if (!game || !game.players)
    //         return;
    //     let meta = await storage.getRoomMeta(room_slug);


    //     let playerRatings = [];
    //     for (var id in game.players) {
    //         let ws = storage.getUser(id);
    //         if (!ws)
    //             continue;

    //         let player = game.players[id];
    //         let playerRating = {
    //             mu: player.mu,
    //             sigma: player.sigma,
    //             rating: player.rating
    //         };
    //         playerRatings.push(playerRating)
    //         r.setPlayerRating(id, meta.game_slug, playerRating);

    //         delete player.sigma;
    //         delete player.mu;
    //     }
    // }

    async killGameRoom(msg) {

        if (!msg.room_slug) {
            console.error("[killGameRoom] Error: Missing room_slug");
            return;
        }

        storage.cleanupRoom(msg.room_slug);
    }

    // async processTimelimit(next) {
    //     let seconds = next.timelimit;
    //     seconds = Math.min(60, Math.max(10, seconds));

    //     let now = (new Date()).getTime();
    //     let deadline = now + (seconds * 1000);
    //     next.deadline = deadline;
    // }
}

module.exports = new RoomUpdate();