import { GameStateReader } from '@acosgames/framework';
declare class RoomUpdate {
    constructor();
    setup(): Promise<void>;
    onAchievementsUpdate(msg: any): Promise<void>;
    onStatsUpdate(msg: any): Promise<void>;
    onQueueUpdate(msg: any): Promise<boolean>;
    onRoomUpdate(msg: any): Promise<boolean>;
    processAllPlayerExperience(game: GameStateReader): void;
    processPlayerExperience(game: GameStateReader, player: PlayerReader): void;
    updateUser(user: any): Promise<void>;
    killGameRoom(msg: any): Promise<void>;
}
declare const _default: RoomUpdate;
export default _default;
//# sourceMappingURL=onRoomUpdate.d.ts.map