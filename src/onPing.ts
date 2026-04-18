import { protoEncode } from 'acos-json-encoder';
import storage from './storage.js';

export default async function onPing(ws: any, action: any): Promise<null> {
    let clientTime = action.payload;
    let serverTime = (new Date()).getTime();
    let offset = serverTime - clientTime;
    let playerCount = storage.getPlayerCount();
    let response = { type: 'pong', payload: { offset, serverTime, playerCount } };
    ws.send(protoEncode(response), true, false);
    return null;
}
