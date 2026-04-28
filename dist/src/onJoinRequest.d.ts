import { GameStateReader } from '@acosgames/framework';
declare class JoinAction {
    onJoinResponse(room_slug: string, game: GameStateReader): Promise<boolean>;
    onJoined(ws: any, room_slug: string, roomState?: any): Promise<boolean>;
    sendResponse(ws: any, type: string, room_slug: string): void;
    onJoinGame(ws: any, action: any): Promise<null>;
    onJoinQueues(ws: any, action: any): Promise<null>;
    generateQueuePlayers(ws: any, partyid: string): Promise<any>;
    validateQueues(ws: any, players: any[], queues: any[]): Promise<any[]>;
    createGameAndJoinSinglePlayer(ws: any, queue: any): Promise<void>;
    sendCreateGameRequest(game_slug: string, room_slug: string, actions: any[], shortid: string): Promise<void>;
    onLeaveQueue(ws: any): Promise<null>;
    isPlayerInRoom(ws: any): Promise<boolean>;
    getPlayerActiveRooms(ws: any): Promise<any>;
}
declare const _default: JoinAction;
export default _default;
//# sourceMappingURL=onJoinRequest.d.ts.map