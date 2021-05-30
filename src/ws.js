
const UWSjs = require('uWebSockets.js/uws');
const uws = UWSjs.App();
const events = require('events');
const auth = require('./authentication');
const { encode, decode } = require('fsg-shared/util/encoder')

const InstanceLocalService = require('fsg-shared/services/instancelocal');
const local = new InstanceLocalService();

const { GeneralError } = require('fsg-shared/util/errorhandler');
const credutil = require('fsg-shared/util/credentials');
const { getLocalAddr } = require('fsg-shared/util/address');

const RedisService = require('fsg-shared/services/redis');
const rabbitmq = require('fsg-shared/services/rabbitmq');

const GameService = require('fsg-shared/services/game');
const g = new GameService();

const RoomService = require('fsg-shared/services/room');
const r = new RoomService();

class WSNode {

    constructor(options) {
        this.credentials = credutil();

        this.evt = new events.EventEmitter();
        this.port = process.env.PORT || this.credentials.platform.wsnode.port;
        this.redis = RedisService;
        this.mq = rabbitmq;

        this.users = {};
        this.rooms = {};

        this.server = {};
        this.cluster = null;
        this.options = options;
    }



    async onRoomUpdate(msg) {
        let room_slug = msg.meta.room_slug;
        if (!room_slug)
            return;

        try {
            delete msg['meta'];
            let encoded = encode(msg);
            //let isOver1kb = msgStr.length > 1000;


            this.app.publish(room_slug, encoded, true, false)
            return true;
        }
        catch (e) {
            console.error(e);
        }
        return false;
    }

    async onJoinResponse(msg) {
        try {
            if (!msg.payload.id)
                return true;

            let id = msg.payload.id;
            let room_slug = msg.payload.room_slug;

            let ws = this.users[id];
            if (!ws)
                return true;
            let pending = ws.pending[room_slug];
            if (!pending) {


                return true;
            }


            delete ws.pending[room_slug];

            if (msg.type == 'join') {
                ws.subscribe(room_slug);
                let roomData = await this.redis.get(room_slug);
                if (roomData) {
                    let encoded = encode(msg);
                    ws.send(encoded, true, false);
                }
                return true;
            }

            if (msg.type == 'full') {
                let response = { type: 'gamefull', payload: { room_slug } };
                ws.send(encode(response), true, false);
                return true;
            }

            let response = { type: 'gameinvalid', payload: { room_slug } };
            ws.send(encode(response), true, false);
            return true
        }
        catch (e) {
            console.error(e);
            return false
        }

    }

    async onClientMessage(ws, message, isBinary) {

        let action = decode(message);
        console.log(action);

        if (!action || !action.type)
            return;

        let userMeta = action.meta;
        action.meta = {};
        action.user = { id: ws.user.shortid };
        switch (action.type) {
            case 'join': {
                await this.requestJoin(ws, action);
                break;
            }
            default: {
                action.meta.room_slug = userMeta.room_slug;
                if (!action)
                    break;
            }
        }

        let room = await this.getRoom(action.meta.room_slug);
        if (!room)
            return;

        action.meta.gameid = room.gameid;
        action.meta.game_slug = room.game_slug;
        action.meta.maxplayers = room.maxplayers;
        action.meta.version = room.version;

        this.forwardAction(action);
    }



    async forwardAction(msg) {

        if (!msg.type) {
            console.error("Action is missing, ignoring message", msg);
            return;
        }
        var game_slug = msg.meta.game_slug;
        if (!game_slug)
            return;

        try {
            let exists = await this.mq.assertQueue(game_slug);
            if (!exists) {
                this.mq.publishQueue('loadGame', msg)
            }
            this.mq.publishQueue(game_slug, msg);
        }
        catch (e) {
            console.error(e);
        }
    }

    async getRoom(room_slug) {
        let room = this.rooms[room_slug];
        if (!room)
            room = await r.findRoom(room_slug);
        if (!room)
            return null;
        return room;
    }

    async cacheRoom(room) {
        this.rooms[room.room_slug] = room;
    }

    async cacheJoin(ws, room) {
        ws.pending[room.room_slug] = true;
    }

    async requestJoin(ws, msg) {
        let isBeta = msg.payload.beta;
        let game_slug = msg.payload.game_slug;

        let room = await r.findAnyRoom(game_slug, isBeta);
        console.log(room);

        if (!ws.pending)
            ws.pending = {};

        //save the room to cache
        this.cacheRoom(room);

        //track user who is pending a join 
        this.cacheJoin(ws, room);

        //these are used by the gameserver to add the user to specific room
        msg.meta.room_slug = room.room_slug;
        msg.user.name = ws.user.displayname

        return true;
    }



    async connect(options) {
        options = options || this.options

        this.options = options || {
            idleTimeout: 30,
            maxBackpressure: 1024,
            maxPayloadLength: 1380,
            compression: UWSjs.DEDICATED_COMPRESSOR_3KB,
            upgrade: this.upgrade.bind(this),
            open: this.onClientOpen.bind(this),
            message: this.onClientMessage.bind(this),
            close: this.onClientClose.bind(this)
        }

        await this.register();
        await this.connectToRedis(options);
        await this.connectToMQ(options);

        this.app = uws.ws('/*', this.options)
            .get('/*', this.anyRoute.bind(this))
            // .get('/player/add/*', this.addPlayer.bind(this))
            // .get('/player/redirect/*', this.redirectPlayer.bind(this))
            // .get('/game/*', this.addGame.bind(this))

            .listen(this.port, this.onListen.bind(this));
        return this.app;
    }

    async register() {

        let params = {
            public_addr: this.port,
            private_addr: getLocalAddr() + ':' + this.credentials.platform.wsnode.port,
            hostname: "wsnode",
            zone: 0,
            instance_type: 1
        }
        this.server = await local.register(params);
        console.log("WS Node registered: ", this.server);
        return this.server;
    }


    async connectToMQ(options) {
        if (!this.server || !this.server.clusters) {
            setTimeout(() => { this.connect(options) }, this.credentials.platform.retryTime);
            return;
        }

        let clusters = this.server.clusters;
        //choose a random MQ server within our zone
        let mqs = clusters.filter(v => v.instance_type == 5);
        this.mqCred = mqs[Math.floor(Math.random() * mqs.length)];
        let pubAddr = this.mqCred.public_addr;
        let privAddr = this.mqCred.private_addr;
        let parts = pubAddr.split(":");
        let host = parts[0];
        let port = parts[1];
        host = "amqp://" + this.credentials.platform.mqCluster.user + ":" + this.credentials.platform.mqCluster.pass + "@" + host + ":" + port;
        let mqOpts = {
            host
        }

        await this.mq.connect(mqOpts);

        this.mq.subscribe('ws', 'onRoomUpdate', this.onRoomUpdate.bind(this));
        this.mq.subscribe('ws', 'onJoinResponse', this.onJoinResponse.bind(this));
    }

    async connectToRedis(options) {
        if (!this.server || !this.server.clusters) {
            setTimeout(() => { this.connect(options) }, this.credentials.platform.retryTime);
            return;
        }

        let clusters = this.server.clusters;
        //choose a random Redis server within our zone
        let redises = clusters.filter(v => v.instance_type == 2);
        this.cluster = redises[Math.floor(Math.random() * redises.length)];
        let pubAddr = this.cluster.public_addr;
        let privAddr = this.cluster.private_addr;
        let parts = pubAddr.split(":");
        let host = parts[0];
        let port = parts[1];
        let redisOptions = {
            host, port
        }

        this.redis.connect(redisOptions);
    }


    onClientClose(ws, code, message) {
        console.log(ws, code, message);
    }

    onClientOpen(ws) {
        if (!ws._logged) {
            console.log('unauthorized user: ', ws)
            ws.end()
            return
        }

        this.users[ws.user.shortid] = ws;
        ws.subscribe(ws.user.shortid);

        console.log("User connected: ", ws);
    }




    async upgrade(res, req, context) {
        auth.upgrade(res, req, context, true);
    }

    verifyAPIKey(res, req) {
        let apikey = req.getHeader('x-api-key');
        if (apikey != '6C312A606D9A4CEBADB174F5FAE31A28') {
            res.end('Not valid');
            return false;
        }

        return true;
    }

    addPlayer(res, req) {
        if (!this.verifyAPIKey(res, req))
            return;
    }
    redirectPlayer(res, req) {
        if (!this.verifyAPIKey(res, req))
            return;
    }
    addGame(res, req) {
        if (!this.verifyAPIKey(res, req))
            return;
    }

    anyRoute(res, req) {
        console.log(req);
        let hookid = req.getHeader('x-github-hook-id');
        console.log("hookid", hookid);
        req.forEach((k, v) => {
            res.write('<li>');
            res.write(k);
            res.write(' = ');
            res.write(v);
            res.write('</li>');
        });
        res.end('</ul>');
    }

    onListen(listenSocket) {
        if (listenSocket) {
            console.log("Mem: ", process.memoryUsage())
            const used = process.memoryUsage().heapUsed / 1024 / 1024;
            console.log(`The script uses approximately ${Math.round(used * 100) / 100} MB`);
        }
        else {
            console.error("something wrong happened");
        }
    }
}

module.exports = new WSNode();