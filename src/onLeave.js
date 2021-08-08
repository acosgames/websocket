
const storage = require('./storage');

module.exports = async function onLeave(ws, action) {
    let room = await storage.getRoomMeta(action.room_slug);
    if (!room)
        return null;

    action.payload = {};
    return action;
}