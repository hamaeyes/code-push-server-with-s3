// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as api from "./api";
import { fileUploadMiddleware } from "./file-upload-manager";
import { RedisManager } from "./redis-manager";
import { Storage } from "./storage/storage";
import { Response } from "express";

import * as bodyParser from "body-parser";
const domain = require("express-domain-middleware");
import * as express from "express";
import * as q from "q";
import { RedisS3Storage } from "./storage/redis-s3-storage";

// RerdisSession 
const session = require('express-session');
const RedisStore = require('connect-redis')(session); // 구버전 방식
const redis = require('redis');

const fs = require("fs");

interface Secret {
  id: string;
  value: string;
}

function bodyParserErrorHandler(err: any, req: express.Request, res: express.Response, next: Function): void {
  if (err) {
    if (err.message === "invalid json" || (err.name === "SyntaxError" && ~err.stack.indexOf("body-parser"))) {
      req.body = null;
      next();
    } else {
      next(err);
    }
  } else {
    next();
  }
}

export function start(done: (err?: any, server?: express.Express, storage?: Storage) => void, useJsonStorage?: boolean): void {
  let storage: Storage;

  q<void>(null)
    .then(async () => {
      storage = new RedisS3Storage();
    })
    .then(() => {
      const app = express();
      const auth = api.auth({ storage: storage });
      const appInsights = api.appInsights();
      const redisManager = new RedisManager();
      const redisClient = redis.createClient({ 
          host: process.env.REDIS_HOST,
          port: process.env.REDIS_PORT,
          auth_pass: process.env.REDIS_KEY,
          tls: {
            // Note: Node defaults CA's to those trusted by Mozilla
            rejectUnauthorized: true, 
            ca: fs.readFileSync(process.env.CUSTOM_REDIS_TLS_CA).toString(),
            cert: fs.readFileSync(process.env.CUSTOM_REDIS_TLS_CRT).toString(),
            key: fs.readFileSync(process.env.CUSTOM_REDIS_TLS_KEY).toString(),
            servername: process.env.CUSTOM_REDIS_TLS_SERVERNAME,
          }
      });
      redisClient.on('connect', () => console.log('🚀 Redis 연결 완료!'));
      redisClient.on('error', (err) => console.error('❌ Redis 오류:', err));
      let redisStore = new RedisStore({client:redisClient, prefix: 'session:'});
 
      
      app.use(domain);

      // Monkey-patch res.send and res.setHeader to no-op after the first call and prevent "already sent" errors.
      app.use((req: express.Request, res: express.Response, next: (err?: any) => void): any => {
        const originalSend = res.send;
        const originalSetHeader = res.setHeader;
        res.setHeader = (name: string, value: string | number | readonly string[]): Response => {
          if (!res.headersSent) {
            originalSetHeader.apply(res, [name, value]);
          }

          return {} as Response;
        };

        res.send = (body: any) => {
          if (res.headersSent) {
            return res;
          }

          return originalSend.apply(res, [body]);
        };

        next();
      });

      if (process.env.LOGGING) {
        app.use((req: express.Request, res: express.Response, next: (err?: any) => void): any => {
          console.log(); // Newline to mark new request
          console.log(`[REST] Received ${req.method} request at ${req.originalUrl}`);
          next();
        });
      }

      // Enforce a timeout on all requests.
      app.use(api.requestTimeoutHandler());

      // Before other middleware which may use request data that this middleware modifies.
      app.use(api.inputSanitizer());

      // body-parser must be before the Application Insights router.
      app.use(bodyParser.urlencoded({ extended: true }));
      const jsonOptions: any = { limit: "10kb", strict: true };
      if (process.env.LOG_INVALID_JSON_REQUESTS === "true") {
        jsonOptions.verify = (req: express.Request, res: express.Response, buf: Buffer, encoding: string) => {
          if (buf && buf.length) {
            (<any>req).rawBody = buf.toString();
          }
        };
      }

      app.use(bodyParser.json(jsonOptions));

      // If body-parser throws an error, catch it and set the request body to null.
      app.use(bodyParserErrorHandler);

      // Before all other middleware to ensure all requests are tracked.
      app.use(appInsights.router());

      app.get("/", (req: express.Request, res: express.Response, next: (err?: Error) => void): any => {
        res.send("Welcome to the CodePush REST API!");
      });

      app.set("etag", false);
      app.set("views", __dirname + "/views");
      app.set("view engine", "ejs");
      app.use("/auth/images/", express.static(__dirname + "/views/images"));
      app.set('trust proxy', true);
      app.use(api.headers({ origin: process.env.CORS_ORIGIN || "http://localhost:4000" }));
      app.use(api.health({ storage: storage, redisManager: redisManager }));
      

      if (process.env.DISABLE_ACQUISITION !== "true") {
        app.use(api.acquisition({ storage: storage, redisManager: redisManager }));
      }

      if (process.env.DISABLE_MANAGEMENT !== "true") {
        if (process.env.DEBUG_DISABLE_AUTH === "true") {
          app.use((req, res, next) => {
            let userId: string = "default";
            if (process.env.DEBUG_USER_ID) {
              userId = process.env.DEBUG_USER_ID;
            } else {
              console.log("No DEBUG_USER_ID environment variable configured. Using 'default' as user id");
            }

            req.user = {
              id: userId,
            };

            next();
          });
        } else {
          app.use(auth.router());
        }
        app.use(auth.authenticate, fileUploadMiddleware, api.management({ storage: storage, redisManager: redisManager }));
      } else {
        app.use(auth.legacyRouter());
      }

      // --- Redis Session ---
      app.use(session({
        store: redisStore,
        secret: 'your-secret-key',  // 필수!
        resave: false,
        saveUninitialized: false,
        cookie: {
          secure: false,  // 개발환경에서는 false, 프로덕션에서는 true
        },
      }));

      // Error handler needs to be the last middleware so that it can catch all unhandled exceptions
      app.use(appInsights.errorHandler);

      done(null, app, storage);
    })
    .done();
}
