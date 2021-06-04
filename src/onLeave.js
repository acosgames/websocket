
async function onLeave(ws, action) {
    let room = await this.getRoom(room_slug);
    if (!room)
        return;
    action.payload = {};
    action.meta = this.setupMeta(room);
    this.forwardAction(action);
}