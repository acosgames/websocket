

class Storage {
    constructor() {
    }

    async getRoomMeta(room_slug) {
        let room = await cache.get(room_slug + '/meta');
        if (!room)
            room = await r.findRoom(room_slug);
        return room || null;
    }

    async setRoom(room_slug) {

    }

    async getRoomState(room_slug) {
        let state = await cache.get(room_slug);
        return state || null;
    }

    async setRoomState(room_slug, state) {

    }

    async getUserById(id) {

    }

    async getUserByShortId(shortid) {

    }

    async getUserRooms(id) {

    }

    async checkUserInGame(id, game_slug) {

    }


}

module.exports = new Storage();