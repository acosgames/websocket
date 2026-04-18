import storage from './storage.js';

export default async function onLeave(ws: any, action: any): Promise<any> {
    let room = await storage.getRoomMeta(action.room_slug);
    if (!room)
        return null;

    ws.unsubscribe(action.room_slug);

    action.payload = {};
    return action;
}
