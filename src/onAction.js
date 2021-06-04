
class Action {



    async onClientAction(ws, message, isBinary) {

        let unsafeAction = null;
        try {
            unsafeAction = decode(message)
        }
        catch (e) {
            console.error(e);
            return;
        }
        console.log("Received from Client: [" + ws.user.shortid + "]", unsafeAction);

        if (!unsafeAction || !unsafeAction.type || typeof unsafeAction.type !== 'string')
            return;

        let action = {};
        action.type = unsafeAction.type;
        action.payload = unsafeAction.payload;
        if (unsafeAction.room_slug) {
            action.meta = {}
            action.meta.room_slug = unsafeAction.room_slug;
        }


        if (action.type == 'ping') {
            this.processPing(ws, action);
            return;
        }

        action.user = { id: ws.user.shortid };

        //preprocess some of the actions to force certain values
        if (action.type == 'join') {
            await this.requestJoin(ws, action);
            return;
        }

        let room_slug = (action.meta && action.meta.room_slug) ? action.meta.room_slug : null;
        if (!room_slug)
            return;

        if (action.type == 'leave') {

            let room = await this.getRoom(room_slug);
            if (!room)
                return;
            action.payload = {};
            action.meta = this.setupMeta(room);
            this.forwardAction(action);
            return;
        }

        let roomData = await this.getRoomData(room_slug);
        if (!roomData)
            return;

        if (action.type == 'skip ') {
            let deadline = roomData.payload.next.deadline;
            let now = (new Date()).getTime();
            if (now < deadline) {
                return;
            }
            action.payload = {
                id: roomData.payload.next.id,
                deadline, now
            }
        }
        else {
            if (!this.validateUser(ws, roomData))
                return;
        }

        let room = await this.getRoom(room_slug);
        if (!room)
            return;

        action.meta = this.setupMeta(room);
        this.forwardAction(action);
    }

}