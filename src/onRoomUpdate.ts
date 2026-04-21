import { protoEncode, createDefaultDict, merge, hidden } from 'acos-json-encoder';
import ACOSDictionary from 'shared/model/acos-dictionary.json' with { type: 'json' };
createDefaultDict(ACOSDictionary);

import storage from './storage.js';
import mq from 'shared/services/rabbitmq.js';
import redis from 'shared/services/redis.js';
import JoinAction from './onJoinRequest.js';
import profiler from 'shared/util/profiler.js';
import r from 'shared/services/room.js';
import person from 'shared/services/person.js';
import { gs, GameStatus } from '@acosgames/framework';

class RoomUpdate {
    constructor() {
    }

    async setup(): Promise<void> {
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
    }

    async onAchievementsUpdate(msg: any): Promise<void> {
        if (msg.type === "rankings") {
            let players = msg.payload;
            let shortids = Object.keys(players);
            for (var shortid of shortids) {
                let ws = await storage.getUser(shortid);
                if (!ws) continue;

                let privateMsg = {
                    type: "achievements",
                    payload: {
                        game_slug: msg.game_slug,
                        player: players[shortid],
                    },
                };
                let encodedPrivate = protoEncode(privateMsg);
                ws.send(encodedPrivate, true, false);
            }
        }
    }

    async onStatsUpdate(msg: any): Promise<void> {
        if (msg.type === "rankings") {
            let players = msg.payload;
            for (var player of players) {
                let { shortid } = player;
                let ws = await storage.getUser(shortid);
                if (!ws) continue;

                let privateMsg = {
                    type: "rankings",
                    payload: player,
                };
                let encodedPrivate = protoEncode(privateMsg);
                ws.send(encodedPrivate, true, false);
            }
        }
    }

    async onQueueUpdate(msg: any): Promise<boolean> {
        if (!msg || !msg.type) {
            return true;
        }
        
        let { players, queues } = msg.payload;

        if (msg.type === "added") {
            if (players) {
                msg.type = "addedQueue";

                // if (queues) {
                //     for (const queue of queues) {
                //         let gameinfo = await storage.getGameInfo(queue.game_slug);
                //         queue.preview_image = gameinfo.preview_images;
                //         queue.name = gameinfo.name;
                //     }
                // }

                let encoded = protoEncode(msg);

                for (const player of players) {
                    let ws = storage.getUser(player.shortid);
                    if (!ws) continue;

                    ws.send(encoded, true, false);
                    console.log("Added to queue: ", player, msg);
                }
            }
        } else if (msg.type === "removed") {
            if (players) {
                let encoded = protoEncode({ type: "removedQueue" });
                for (const player of players) {
                    let ws = storage.getUser(player.shortid);
                    if (!ws) continue;

                    ws.send(encoded, true, false);
                    console.log("Removed from queue: ", player, msg);
                }
            }
        } else if (msg.type === "queueStats") {
            storage.setQueueStats(msg);
            let app = storage.getWSApp();
            app.publish("acos", protoEncode(msg), true, false);
        }

        return true;
    }

    async onRoomUpdate(msg: any): Promise<boolean> {
        profiler.EndTime("ActionUpdateLoop", 0);
        profiler.StartTime('onRoomUpdate');
        console.log("Game Updated Received: ", (new Date()).getTime());
        let room_slug = msg.room_slug;
        if (!room_slug) 
            return true;

        try {
            let previousGamestate = (await storage.getRoomState(room_slug)) || {};
            if (!previousGamestate) {
                this.killGameRoom({ room_slug });
                return true;
            }

            let action = msg.payload.action;

            if (action?.user?.shortid) action.user = action.user.shortid;

            if (action && "timeseq" in action) delete action.timeseq;

            if (action && "timeleft" in action) delete action.timeleft;

            if (action && "room_slug" in action) delete action.room_slug;

            if (msg.payload.action) delete msg.payload.action;

            previousGamestate.action = null;
            if (previousGamestate?.room?.events)
                previousGamestate.room.events = null;

            let mergedState = merge(previousGamestate, msg.payload);
            if (!mergedState) {
                this.killGameRoom({ room_slug });
                return true;
            }

            let gamestate = gs(mergedState);

            let copy = JSON.parse(JSON.stringify(msg));
            let hiddenState = hidden(copy.payload.state);
            let hiddenPlayers = hidden(copy.payload.players);
            let hiddenRoom = hidden(copy.payload.room);

            let gameroom = gamestate.room();
            let isGameover =
                gameroom?.events &&
                (gameroom?.status == GameStatus.gameover ||
                    // gameroom?.status == GameStatus.gamecancelled ||
                    gameroom?.status == GameStatus.gameerror);

            storage.setRoomState(room_slug, gamestate.raw());

            if (msg.type === "join") {
                await JoinAction.onJoinResponse(room_slug, gamestate);
            }

            if (hiddenPlayers)
                for (var shortid in hiddenPlayers) {
                    let ws = storage.getUser(shortid);
                    if (!ws) continue;

                    let privateMsg = {
                        type: "private",
                        payload: {
                            room_slug,
                            player: hiddenPlayers[shortid],
                        }
                    };
                    let encodedPrivate = protoEncode(privateMsg);
                    ws.send(encodedPrivate, true, false);
                }

            if (msg.type === "gameover" && gamestate?.room?.events?.gameover) {
                this.processAllPlayerExperience(gamestate);
            }

            let app = storage.getWSApp();
            let encoded = protoEncode({ type: "gameupdate", payload: copy });
            app.publish(room_slug, encoded, true, false);

            if (copy.type === "error") {
                if (copy?.action?.type === "join") {
                    for (let shortid in copy.payload.players) {
                        let ws = storage.getUser(shortid);
                        if (ws) ws.send(encoded, true, false);
                    }
                }
                this.killGameRoom({ room_slug });
            }

            profiler.EndTime('onRoomUpdate', 0);

            return true;
        } catch (e) {
            console.error(e);
        }
        return false;
    }

    processAllPlayerExperience(gamestate: any): void {
        if (!gamestate?.players) return;

        for (let shortid in gamestate.players) {
            this.processPlayerExperience(gamestate, shortid);
        }
    }

    processPlayerExperience(gamestate: any, shortid: string): void {
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
            playerList.reduce((highest: number, sid: string) => {
                let p = gamestate.players[sid];
                if (p.score > highest) highest = p.score;
                return highest;
            }, 0) || 1;
        let maxScoreXP = 5;
        let highScorePct = player.score / highestScore;
        let scoreXP = Math.ceil(highScorePct * maxScoreXP * bonusTime);

        let winXP = 0;
        if (player.teamid && gamestate?.teams[player.teamid]?.rank === 1) {
            winXP = Math.ceil(5 * bonusTime);
        }

        let experience: any[] = [];
        experience.push({ type: "Match Complete", value: playTime });
        experience.push({ type: "Score", value: scoreXP });
        if (winXP > 0) experience.push({ type: "Win", value: winXP });

        let totalXP = experience.reduce((total: number, xp: any) => {
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
            payload: {
                room_slug: room?.room_slug || "",
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

        let encodedMessage = protoEncode(xpMessage);
        ws.send(encodedMessage, true, false);
    }

    async updateUser(user: any): Promise<void> {
        try {
            await person.updateUser(user, null);
        } catch (e) {
            console.error(e);
        }
    }

    async killGameRoom(msg: any): Promise<void> {
        if (!msg.room_slug) {
            console.error("[killGameRoom] Error: Missing room_slug");
            return;
        }

        let meta = await storage.getRoomMeta(msg.room_slug);
        storage.cleanupRoom(meta);
    }
}

export default new RoomUpdate();
