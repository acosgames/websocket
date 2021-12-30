const cache = require("shared/services/cache");
const r = require('shared/services/room');




class Storage {
    constructor() {
        this.users = {};
        this.app = null;
    }

    setWSApp(app) {
        this.app = app;
    }
    getWSApp() {
        return this.app;
    }



    async getRoomMeta(room_slug) {
        let room = await r.findRoom(room_slug);
        return room || null;
    }

    async getRoomState(room_slug) {
        let state = await cache.get(room_slug);
        return state || null;
    }

    async setRoomState(room_slug, state) {
        await cache.setLocal(room_slug, state);
    }

    async getGameInfo(game_slug) {

    }

    async getRoomCounts(room_slug) {
        let roomMeta = await this.getRoomMeta(room_slug);
        if (!roomMeta)
            return null;
        let roomState = await this.getRoomState(room_slug);
        if (!roomState || !roomState.players)
            return null;
        let playerList = Object.keys(roomState.players);
        if (!playerList)
            return null;

        return { count: playerList.length, min: roomMeta.minplayers, max: roomMeta.maxplayers };
    }

    addUser(ws) {
        this.users[ws.user.shortid] = ws;
        cache.set(ws.user.shortid, 1);
    }

    removeUser(ws) {
        let id = ws.user.shortid;
        if (this.users[id])
            delete this.users[id];
        cache.del(ws.user.shortid);
    }

    getUser(id) {
        return this.users[id];
    }

    async getUserByShortId(shortid) {

    }

    async getPlayerRoomsByGame(id, game_slug) {
        let key = `rooms/${game_slug}/${id}`;
        let rooms = await cache.get(key);
        if (rooms)
            return rooms;
        rooms = await r.findPlayerRoom(id, game_slug);
        cache.set(key, rooms, 100);
        return rooms;
    }

    async getPlayerRooms(id) {
        let key = `rooms/${id}`;
        let rooms = await cache.getremote(key);
        if (rooms && rooms.length > 0)
            return rooms;

        rooms = await r.findPlayerRooms(id);
        cache.setremote(key, rooms, 100);
        return rooms;
    }

    async checkUserInGame(id, game_slug) {

    }

    async setUserRoom(id, roomMeta) {

    }

    async cleanupRoom(room_slug) {

        try {
            let roomState = await this.getRoomState(room_slug);
            let players = roomState?.players;
            if (players) {

                for (var id in players) {
                    cache.del(`rooms/${id}`);
                }

            }

            Promise.all([
                cache.del(room_slug),
                cache.del(room_slug + '/meta'),
                cache.del(room_slug + '/timer'),
                cache.del(room_slug + '/p')
            ]);

            r.deleteRoom(room_slug);
        }
        catch (e) {
            console.error(e);
        }

    }

}

module.exports = new Storage();