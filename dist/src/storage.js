import cache from 'shared/services/cache.js';
import r from 'shared/services/room.js';
// import delta from 'acos-json-delta';
import { gs } from '@acosgames/framework';
import { hidden } from 'acos-json-encoder';
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
    async setParty(partyid, partyinfo) {
        cache.set("party/" + partyid, partyinfo, 120);
    }
    async getParty(partyid) {
        let partyinfo = await cache.get("party/" + partyid);
        return partyinfo;
    }
    async deleteTeam(partyid) {
        await cache.del("party/" + partyid);
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
                let game = gs(dlta);
                let playerid = game.playerIndex(shortid);
                let hiddenState = null;
                if (dlta.state)
                    hiddenState = hidden(dlta.state);
                let hiddenPlayers = hidden(dlta.players) || {};
                if (hiddenPlayers && dlta?.players) {
                    if (hiddenPlayers[playerid]) {
                        dlta.players[playerid] = Object.assign({}, dlta.players[playerid] || {}, hiddenPlayers[playerid] || {});
                    }
                }
            }
            return dlta || null;
        }
        catch (e) {
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
        }
        catch (e) {
            console.error(e);
        }
        return null;
    }
    async getRoomCounts(room_slug) {
        let roomMeta = await this.getRoomMeta(room_slug);
        if (!roomMeta)
            return null;
        let roomState = await this.getRoomState(room_slug);
        if (!roomState || !roomState.players)
            return null;
        // let playerList = Object.keys(roomState.players);
        if (!roomState.players)
            return null;
        return {
            count: roomState.players.length,
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
        if (this.users[shortid])
            delete this.users[shortid];
        cache.del(ws.user.shortid);
        this.userCount--;
    }
    getUser(shortid) {
        return this.users[shortid];
    }
    async getUserByShortId(shortid) { }
    async getPlayerRoomsByGame(shortid, game_slug) {
        let key = `rooms/${game_slug}/${shortid}`;
        let rooms = await cache.get(key);
        if (rooms)
            return rooms;
        rooms = await r.findPlayerRoom(shortid, game_slug);
        cache.set(key, rooms, 100);
        return rooms;
    }
    async getPlayerRooms(shortid) {
        let rooms = await r.findPlayerRooms(shortid);
        if (!rooms)
            return [];
        return rooms;
    }
    async checkUserInGame(shortid, game_slug) { }
    async setUserRoom(shortid, roomMeta) { }
    async cleanupRoom(meta) {
        try {
            if (!meta?.room_slug)
                return;
            let roomState = await this.getRoomState(meta.room_slug);
            if (roomState) {
                let game = gs(roomState);
                let players = game.playerMap;
                if (players) {
                    for (var shortid in players) {
                        cache.del(`rooms/${shortid}`);
                    }
                }
            }
            Promise.all([
                cache.del(meta.room_slug),
                cache.del(meta.room_slug + "/meta"),
                cache.del(meta.room_slug + "/timer"),
            ]);
            r.deleteRoom(meta, roomState);
        }
        catch (e) {
            console.error(e);
        }
    }
}
export default new Storage();
//# sourceMappingURL=storage.js.map