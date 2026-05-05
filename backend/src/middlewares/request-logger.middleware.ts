import { NextFunction, Request, Response } from 'express';

import { logger } from '../utils/logger';

const IS_PRODUCTION = process.env['NODE_ENV'] === 'production';

/**
 * Per-request HTTP logger.
 * Dev:  →  POST /api/auth/code/exchange  200  47ms
 * Prod: {"level":"info","method":"POST","path":"/api/auth/code/exchange","status":200,"ms":47}
 */
export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    res.on('finish', () => {
        const ms = Date.now() - start;
        const method = req.method.padEnd(6);
        const path = req.path;
        const status = res.statusCode;

        if (IS_PRODUCTION) {
            logger.info('http', { method: req.method, path, status, ms });
        } else {
            // Colour code by status bucket: 2xx green, 3xx cyan, 4xx yellow, 5xx red
            const statusStr =
                status >= 500 ? `\x1b[31m${status}\x1b[0m` :
                    status >= 400 ? `\x1b[33m${status}\x1b[0m` :
                        status >= 300 ? `\x1b[36m${status}\x1b[0m` :
                            `\x1b[32m${status}\x1b[0m`;

            // eslint-disable-next-line no-console
            console.log(`\x1b[90m→\x1b[0m  ${method} ${path.padEnd(45)} ${statusStr}  ${ms}ms`);
        }
    });

    next();
};
