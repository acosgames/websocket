declare class Storage {
    users: Record<string, any>;
    userCount: number;
    app: any;
    queueStats: any;
    constructor();
    setWSApp(app: any): void;
    getWSApp(): any;
    getPlayerCount(): number;
    setQueueStats(queueStats: any): void;
    getQueueStats(): any;
    setParty(partyid: string, partyinfo: any): Promise<void>;
    getParty(partyid: string): Promise<any>;
    deleteTeam(partyid: string): Promise<void>;
    getRoomMeta(room_slug: string): Promise<any>;
    getRoomState(room_slug: string, shortid?: string): Promise<any>;
    setRoomState(room_slug: string, state: any): Promise<void>;
    getGameInfo(game_slug: string): Promise<any>;
    getRoomCounts(room_slug: string): Promise<any>;
    addUser(ws: any): void;
    removeUser(ws: any): void;
    getUser(shortid: string): any;
    getUserByShortId(shortid: string): Promise<any>;
    getPlayerRoomsByGame(shortid: string, game_slug: string): Promise<any>;
    getPlayerRooms(shortid: string): Promise<any[]>;
    checkUserInGame(shortid: string, game_slug: string): Promise<any>;
    setUserRoom(shortid: string, roomMeta: any): Promise<any>;
    cleanupRoom(meta: any): Promise<void>;
}
declare const _default: Storage;
export default _default;
//# sourceMappingURL=storage.d.ts.map