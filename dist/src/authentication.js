import { v4 as uuidv4 } from 'uuid';
import * as cookie from './cookie.js';
import persons from 'shared/services/person.js';
import credutil from 'shared/util/credentials.js';
class Authentication {
    constructor(credentials) {
        this.credentials = credentials || credutil();
        this.users = {};
        this.wss = null;
    }
    attach(WSServer) {
        this.wss = WSServer;
    }
    async upgrade(res, req, context) {
        res.onAborted(() => {
            res.aborted = true;
        });
        let user = null;
        try {
            let loggedIn = "LURKER";
            const _cookie = cookie.parse(req.getHeader("cookie"));
            let key = req.getHeader("sec-websocket-key");
            let jwtToken = req.getHeader("sec-websocket-protocol");
            let ext = req.getHeader("sec-websocket-extensions");
            console.log("WS Cookie: ", req.getHeader("cookie"));
            if (jwtToken === "LURKER") {
                user = { shortid: "SPECTATOR", displayname: "Spectator" };
            }
            else {
                try {
                    user = await persons.decodeUserToken(jwtToken);
                    if (!user) {
                        console.error("User attempted invalid JWT: ", user, jwtToken);
                    }
                    else if (user.email) {
                        loggedIn = "USER";
                        user = await persons.findUser(user);
                    }
                    else if (user.displayname) {
                        loggedIn = "TEMP";
                        user = await persons.findUser(user);
                    }
                }
                catch (e) {
                    console.error("[Upgrade Error] for user:", user, jwtToken);
                    console.error(e);
                }
            }
            const pending = {};
            res.upgrade({ loggedIn, user, pending }, key, jwtToken, ext, context);
            console.log("finished upgrade", _cookie);
        }
        catch (e) {
            console.error(e);
            if (!res.aborted) {
                res.end();
            }
        }
    }
    async check(apikey) {
        try {
            let user = { apikey };
            user = await persons.findUser(user);
            return user;
        }
        catch (e) {
            console.error(e);
        }
        return null;
    }
    generateAPIKey() {
        return uuidv4().replace(/\-/gi, "");
    }
    checkLogin(request, response, next) {
        if (!request.session.user) {
            let passed = this.loginUser(request, response);
            if (!passed) {
                console.log("User is not authenticated");
                response.json({ error: "E_INVALID_AUTH" });
                return;
            }
        }
        else {
            let user = request.session.user;
            this.users[user.apikey] = user;
        }
        next();
    }
    loginUser(request, response) {
        return false;
    }
}
export default new Authentication();
//# sourceMappingURL=authentication.js.map