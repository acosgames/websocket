const storage = require('./storage');

module.exports = async function onSkip(ws, action) {

    let roomState = await storage.getRoomState(room_slug);
    if (!roomState)
        return null;

    let deadline = roomState.payload.next.deadline;
    let now = (new Date()).getTime();
    if (now < deadline) {
        return null;
    }

    action.payload = {
        id: roomState.payload.next.id,
        deadline, now
    }

    return action;
}