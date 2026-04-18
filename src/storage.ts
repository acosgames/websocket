import cache from 'shared/services/cache.js';
import r from 'shared/services/room.js';
import delta from 'acos-json-delta';

class Storage {
    users: Record<string, any>;
    userCount: number;
    app: any;
    queueStats: any;

    constructor() {
        this.users = {};
        this.userCount = 0;
        this.app = null;
        this.queueStats = null;
    }

    setWSApp(app: any): void {
        this.app = app;
    }

    getWSApp(): any {
        return this.app;
    }

    getPlayerCount(): number {
        return this.userCount || 0;
    }

    setQueueStats(queueStats: any): void {
        this.queueStats = queueStats;
    }

    getQueueStats(): any {
        return this.queueStats;
    }

    async setParty(partyid: string, partyinfo: any): Promise<void> {
        cache.set("party/" + partyid, partyinfo, 120);
    }

    async getParty(partyid: string): Promise<any> {
        let partyinfo = await cache.get("party/" + partyid);
        return partyinfo;
    }

    async deleteTeam(partyid: string): Promise<void> {
        await cache.del("party/" + partyid);
    }

    async getRoomMeta(room_slug: string): Promise<any> {
        let room = await r.findRoom(room_slug);
        return room || null;
    }

    async getRoomState(room_slug: string, shortid?: string): Promise<any> {
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

    async setRoomState(room_slug: string, state: any): Promise<void> {
        await cache.setLocal(room_slug, state);
    }

    async getGameInfo(game_slug: string): Promise<any> {
        try {
            let gameinfo = await r.getGameInfo(game_slug);
            return gameinfo;
        } catch (e) {
            console.error(e);
        }
        return null;
    }

    async getRoomCounts(room_slug: string): Promise<any> {
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

    addUser(ws: any): void {
        this.users[ws.user.shortid] = ws; 
        cache.set(ws.user.shortid, 1);
        this.userCount++;
    }

    removeUser(ws: any): void {
        let shortid = ws.user.shortid;
        if (this.users[shortid]) delete this.users[shortid];
        cache.del(ws.user.shortid);
        this.userCount--;
    }

    getUser(shortid: string): any {
        return this.users[shortid];
    }

    async getUserByShortId(shortid: string): Promise<any> {}

    async getPlayerRoomsByGame(shortid: string, game_slug: string): Promise<any> {
        let key = `rooms/${game_slug}/${shortid}`;
        let rooms = await cache.get(key);
        if (rooms) return rooms;
        rooms = await r.findPlayerRoom(shortid, game_slug);
        cache.set(key, rooms, 100);
        return rooms;
    }

    async getPlayerRooms(shortid: string): Promise<any[]> {
        let rooms = await r.findPlayerRooms(shortid);
        if (!rooms) return [];
        return rooms;
    }

    async checkUserInGame(shortid: string, game_slug: string): Promise<any> {}

    async setUserRoom(shortid: string, roomMeta: any): Promise<any> {}

    async cleanupRoom(meta: any): Promise<void> {
        try {
            if (!meta?.room_slug) return;
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
            ]);

            r.deleteRoom(meta, roomState);
        } catch (e) {
            console.error(e);
        }
    }
}

export default new Storage();
