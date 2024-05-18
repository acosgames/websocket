const cache = require("shared/services/cache");
const r = require("shared/services/room");

const delta = require("acos-json-delta");

class Storage {
    constructor() {
        this.users = {};
        this.userCount = 0;
        this.app = null;

        this.queueStats = null;
    }

    setWSApp(app) {
        this.app = app;
    }
    getWSApp() {
        return this.app;
    }

    getPlayerCount() {
        return this.userCount || 0;
    }

    setQueueStats(queueStats) {
        this.queueStats = queueStats;
    }

    getQueueStats() {
        return this.queueStats;
    }

    async setParty(teamid, partyinfo) {
        cache.set("team/" + teamid, partyinfo, 120);
    }

    async getParty(teamid) {
        let partyinfo = await cache.get("team/" + teamid);
        return partyinfo;
    }

    async deleteTeam(teamid) {
        await cache.del("team/" + teamid);
    }

    async getRoomMeta(room_slug) {
        let room = await r.findRoom(room_slug);
        return room || null;
    }

    async getRoomState(room_slug, shortid) {
        try {
            let state = await cache.get(room_slug);
            let dlta = JSON.parse(JSON.stringify(state));
            if (dlta && shortid) {
                let hiddenState = null;
                if (dlta.state) hiddenState = delta.hidden(dlta.state);
                let hiddenPlayers = delta.hidden(dlta.players) || {};

                if (hiddenPlayers && dlta?.players) {
                    if (shortid in hiddenPlayers) {
                        dlta.players[shortid] = Object.assign(
                            {},
                            dlta.players[shortid] || {},
                            hiddenPlayers[shortid] || {}
                        );
                    }
                }
            }

            return dlta || null;
        } catch (e) {
            console.error(e);
        }
        return null;
    }

    async setRoomState(room_slug, state) {
        await cache.setLocal(room_slug, state);
    }

    async getGameInfo(game_slug) {
        try {
            let gameinfo = await r.getGameInfo(game_slug);
            return gameinfo;
        } catch (e) {
            console.error(e);
        }
        return null;
    }

    async getRoomCounts(room_slug) {
        let roomMeta = await this.getRoomMeta(room_slug);
        if (!roomMeta) return null;
        let roomState = await this.getRoomState(room_slug);
        if (!roomState || !roomState.players) return null;
        let playerList = Object.keys(roomState.players);
        if (!playerList) return null;

        return {
            count: playerList.length,
            min: roomMeta.minplayers,
            max: roomMeta.maxplayers,
        };
    }

    addUser(ws) {
        this.users[ws.user.shortid] = ws;
        cache.set(ws.user.shortid, 1);
        this.userCount++;
    }

    removeUser(ws) {
        let shortid = ws.user.shortid;
        if (this.users[shortid]) delete this.users[shortid];
        cache.del(ws.user.shortid);
        this.userCount--;
    }

    getUser(shortid) {
        return this.users[shortid];
    }

    async getUserByShortId(shortid) {}

    async getPlayerRoomsByGame(shortid, game_slug) {
        let key = `rooms/${game_slug}/${shortid}`;
        let rooms = await cache.get(key);
        if (rooms) return rooms;
        rooms = await r.findPlayerRoom(shortid, game_slug);
        cache.set(key, rooms, 100);
        return rooms;
    }

    async getPlayerRooms(shortid) {
        // let key = `rooms/${shortid}`;
        // let rooms = await cache.getremote(key);
        // if (rooms && rooms.length > 0)
        // return rooms;

        let rooms = await r.findPlayerRooms(shortid);
        if (!rooms) return [];
        // cache.setremote(key, rooms, 100);
        return rooms;
    }

    async checkUserInGame(shortid, game_slug) {}

    async setUserRoom(shortid, roomMeta) {}

    async cleanupRoom(meta) {
        try {
            let roomState = await this.getRoomState(meta.room_slug);
            let players = roomState?.players;
            if (players) {
                for (var shortid in players) {
                    cache.del(`rooms/${shortid}`);
                }
            }

            Promise.all([
                cache.del(meta.room_slug),
                cache.del(meta.room_slug + "/meta"),
                cache.del(meta.room_slug + "/timer"),
                cache.del(meta.room_slug + "/p"),
            ]);

            r.deleteRoom(meta.room_id);
        } catch (e) {
            console.error(e);
        }
    }
}

module.exports = new Storage();
