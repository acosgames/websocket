
const storage = require('./storage');

module.exports = async function onLeave(ws, action) {
    let room = await storage.getRoomMeta(action.room_slug);
    if (!room)
        return null;

    ws.unsubscribe(action.room_slug);

    action.payload = {};
    return action;
}