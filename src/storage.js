const cache = require("fsg-shared/services/cache");
const r = require('fsg-shared/services/room');




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
        let room = await cache.get(room_slug + '/meta');
        if (!room)
            room = await r.findRoom(room_slug);
        return room || null;
    }

    async setRoomMeta(room_slug, meta) {
        await cache.set(room_slug + '/meta', meta);
    }

    async getRoomState(room_slug) {
        let state = await cache.get(room_slug);
        return state || null;
    }

    async setRoomState(room_slug, state) {
        await cache.set(room_slug, state);
    }

    addUser(ws) {
        this.users[ws.user.shortid] = ws;
    }

    removeUser(ws) {
        let id = ws.user.shortid;
        if (this.users[id])
            delete this.users[id];
    }

    getUser(id) {
        return this.users[id];
    }

    async getUserByShortId(shortid) {

    }

    async getUserRooms(id) {

    }

    async checkUserInGame(id, game_slug) {

    }

    async setUserRoom(id, roomMeta) {

    }

    async cleanupRoom(room_slug) {

        await Promise.all([
            cache.del(room_slug),
            cache.del(room_slug + '/meta')
        ]);

        r.deleteRoom(room_slug);
    }

}

module.exports = new Storage();