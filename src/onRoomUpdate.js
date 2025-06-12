const { encode, createDefaultDict } = require("acos-json-encoder");
let ACOSDictionary = require("shared/model/acos-dictionary.json");
createDefaultDict(ACOSDictionary);
const storage = require("./storage");

const mq = require("shared/services/rabbitmq");
const redis = require("shared/services/redis");
const JoinAction = require("./onJoinRequest");
const profiler = require("shared/util/profiler");
const delta = require("acos-json-delta");
const r = require("shared/services/room");
const person = require("shared/services/person");
// const person = new PersonService();

class RoomUpdate {
    constructor() {
        this.setup();
    }

    async setup() {
        if (!mq.isActive() || !redis.isActive) {
            setTimeout(this.setup.bind(this), 2000);
            return;
        }

        setTimeout(async () => {
            let qWS = await mq.findExistingQueue("ws");
            await mq.subscribeQueue(qWS, this.onRoomUpdate.bind(this));

            let queueKey = await mq.subscribe(
                "ws",
                "onRoomUpdate",
                this.onRoomUpdate.bind(this),
                qWS
            );
        }, 5000);

        setTimeout(async () => {
            let qWS2 = await mq.findExistingQueue("queue");
            await mq.subscribeQueue(qWS2, this.onQueueUpdate.bind(this));

            let queueKey = await mq.subscribe(
                "ws",
                "onQueueUpdate",
                this.onQueueUpdate.bind(this),
                qWS2
            );
        }, 5000);

        setTimeout(async () => {
            let qWS2 = await mq.findExistingQueue("stats");
            await mq.subscribeQueue(qWS2, this.onStatsUpdate.bind(this));

            let queueKey = await mq.subscribe(
                "ws",
                "onStatsUpdate",
                this.onStatsUpdate.bind(this),
                qWS2
            );
        }, 5000);

        setTimeout(async () => {
            let qWS2 = await mq.findExistingQueue("achievements");
            await mq.subscribeQueue(qWS2, this.onAchievementsUpdate.bind(this));

            let queueKey = await mq.subscribe(
                "ws",
                "onAchievementsUpdate",
                this.onAchievementsUpdate.bind(this),
                qWS2
            );
        }, 5000);

        //mq.subscribe('ws', 'onJoinResponse', JoinAction.onJoinResponse.bind(JoinAction));
    }

    async onAchievementsUpdate(msg) {
        //send player their latest win/loss/tie career stats and new rating
        if (msg.type == "rankings") {
            let players = msg.payload;
            let shortids = Object.keys(players);
            for (var shortid of shortids) {
                let ws = await storage.getUser(shortid);
                if (!ws) continue;

                let privateMsg = {
                    type: "achievements",
                    game_slug: msg.game_slug,
                    payload: players[shortid],
                };
                let encodedPrivate = encode(privateMsg);
                // console.log("Publishing Private [" + room_slug + "] with " + encodedPrivate.byteLength + ' bytes', JSON.stringify(privateMsg, null, 2));

                ws.send(encodedPrivate, true, false);
            }
        }
    }

    async onStatsUpdate(msg) {
        //send player their latest win/loss/tie career stats and new rating
        if (msg.type == "rankings") {
            let players = msg.payload;
            for (var player of players) {
                let { shortid } = player;
                let ws = await storage.getUser(shortid);
                if (!ws) continue;

                let privateMsg = {
                    type: "rankings",
                    payload: player,
                };
                let encodedPrivate = encode(privateMsg);
                // console.log("Publishing Private [" + room_slug + "] with " + encodedPrivate.byteLength + ' bytes', JSON.stringify(privateMsg, null, 2));

                ws.send(encodedPrivate, true, false);
            }
        }
    }

    async onQueueUpdate(msg) {
        if (!msg || !msg.type) {
            return true;
        }

        let party = msg.payload;

        if (msg.type == "added") {
            if (party.players) {
                msg.type = "addedQueue";
                let encoded = encode(msg);
                for (const player of party.players) {
                    let ws = storage.getUser(player.shortid);
                    if (!ws) continue;

                    ws.send(encoded, true, false);
                    console.log("Added to queue: ", player, msg);
                }
            }
        } else if (msg.type == "removed") {
            if (party.players) {
                let encoded = encode({ type: "removedQueue" });
                for (const player in party.players) {
                    let ws = storage.getUser(player.shortid);
                    if (!ws) continue;

                    ws.send(encoded, true, false);
                    console.log("Added to queue: ", player, msg);
                }
            }
        } else if (msg.type == "queueStats") {
            storage.setQueueStats(msg);
            let app = storage.getWSApp();
            app.publish("acos", encode(msg), true, false);
        }
    }

    async onRoomUpdate(msg) {
        // profiler.StartTime('onRoomUpdate');
        let room_slug = msg.room_slug;
        if (!room_slug) return true;

        try {
            let previousGamestate =
                (await storage.getRoomState(room_slug)) || {};
            if (!previousGamestate) {
                this.killGameRoom({ room_slug });
                return true;
            }

            let action = msg.payload.action;

            if (action?.user?.shortid) action.user = action.user.shortid;

            if (action && "timeseq" in action) delete action.timeseq;

            if (action && "timeleft" in action) delete action.timeleft;

            if (action && "room_slug" in action) delete action.room_slug;

            // msg.payload.action = action;
            if (msg.payload.action) delete msg.payload.action;

            previousGamestate.action = null;
            previousGamestate.room.events = null;

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

            let isGameover =
                gamestate?.room?.events &&
                (gamestate.room?.events.gameover ||
                    gamestate.room?.events.gamecancelled ||
                    gamestate.room?.events.gameerror);

            storage.setRoomState(room_slug, gamestate);

            if (msg.type == "join") {
                await JoinAction.onJoinResponse(room_slug, gamestate);
            }

            if (hiddenPlayers)
                for (var shortid in hiddenPlayers) {
                    let ws = storage.getUser(shortid);
                    if (!ws) continue;

                    let privateMsg = {
                        type: "private",
                        room_slug,
                        payload: hiddenPlayers[shortid],
                    };
                    let encodedPrivate = encode(privateMsg);
                    // console.log("Publishing Private [" + room_slug + "] with " + encodedPrivate.byteLength + ' bytes', JSON.stringify(privateMsg, null, 2));

                    ws.send(encodedPrivate, true, false);
                }

            if (msg.type == "gameover" && gamestate?.room?.events?.gameover) {
                this.processAllPlayerExperience(gamestate);
            }

            // if (copy.payload.kick) {
            //     this.kickPlayers(copy);
            // }

            // setTimeout(() => {
            let app = storage.getWSApp();
            let encoded = encode(copy);
            // console.log("Publishing [" + room_slug + "] with " + encoded.byteLength + ' bytes', JSON.stringify(copy, null, 2));
            app.publish(room_slug, encoded, true, false);

            if (copy.type == "error") {
                if (copy?.action?.type == "join") {
                    for (let shortid in copy.payload.players) {
                        let ws = storage.getUser(shortid);
                        if (ws) ws.send(encoded, true, false);
                    }
                }
                this.killGameRoom({ room_slug });
            }
            // }, 200)

            profiler.EndTime("ActionUpdateLoop");

            return true;
        } catch (e) {
            console.error(e);
        }
        return false;
    }

    processAllPlayerExperience(gamestate) {
        if (!gamestate?.players) return;

        for (let shortid in gamestate.players) {
            this.processPlayerExperience(gamestate, shortid);
        }
    }

    processPlayerExperience(gamestate, shortid) {
        let player = gamestate.players[shortid];
        let ws = storage.getUser(shortid);
        if (!ws) return;

        let room = gamestate?.room;
        let startTime = room?.starttime || 0;
        let endTime = room?.endtime || startTime;
        let playTime = (endTime - startTime) / 1000;
        playTime = Math.ceil(playTime);
        let bonusTime = playTime / 10;

        let playerList = Object.keys(gamestate?.players);
        let highestScore =
            playerList.reduce((highest, sid) => {
                let p = gamestate.players[sid];
                if (p.score > highest) highest = p.score;
                return highest;
            }, 0) || 1;
        let maxScoreXP = 5;
        let highScorePct = player.score / highestScore;
        let scoreXP = Math.ceil(highScorePct * maxScoreXP * bonusTime);

        let winXP = 0;
        if (player.teamid && gamestate?.teams[player.teamid]?.rank == 1) {
            winXP = Math.ceil(5 * bonusTime);
        }

        let experience = [];
        experience.push({ type: "Match Complete", value: playTime });
        experience.push({ type: "Score", value: scoreXP });
        if (winXP > 0) experience.push({ type: "Win", value: winXP });

        let totalXP = experience.reduce((total, xp) => {
            total += xp.value;
            return total;
        }, 0);

        let previousPoints = Math.trunc(
            (ws.user.level - Math.trunc(ws.user.level)) * 1000
        );
        let previousLevel = Math.trunc(ws.user.level);
        let newPoints = previousPoints + totalXP;
        let newLevel = previousLevel;

        let earnedLevels = Math.floor(newPoints / 1000);
        if (earnedLevels > 0) {
            newLevel += earnedLevels;
            newPoints = newPoints % 1000;
        }

        let xpMessage = {
            type: "xp",
            room_slug: room?.room_slug || "",
            payload: {
                experience,
                previousPoints,
                previousLevel,
                points: totalXP,
                level: newLevel,
            },
        };

        let user = {
            shortid,
            level: newLevel + newPoints / 1000,
        };
        this.updateUser(user);

        let encodedMessage = encode(xpMessage);
        ws.send(encodedMessage, true, false);
    }

    async updateUser(user) {
        try {
            await person.updateUser(user);
        } catch (e) {
            console.error(e);
        }
    }

    async killGameRoom(msg) {
        if (!msg.room_slug) {
            console.error("[killGameRoom] Error: Missing room_slug");
            return;
        }

        let meta = await storage.getRoomMeta(msg.room_slug);

        storage.cleanupRoom(meta);
    }
}

module.exports = new RoomUpdate();
