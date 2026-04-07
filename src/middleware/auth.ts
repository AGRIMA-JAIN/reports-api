// src/middleware/auth.ts

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { store } from '../models/store';
import { User, UserRole } from '../types';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';
import { logger } from '../utils/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
export const JWT_EXPIRY = process.env.JWT_EXPIRY || '8h';

// ── Token helpers 

export interface TokenPayload {
  sub: string;   // userId
  email: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export function signToken(user: User): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET as string,
    { expiresIn: '8h' }
  );
}

// ── Middleware: require authenticated user 

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header.');
  }

  const token = authHeader.slice(7);
  let payload: TokenPayload;

  try {
    payload = jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (err) {
    const isExpired = err instanceof jwt.TokenExpiredError;
    throw new UnauthorizedError(isExpired ? 'Token has expired.' : 'Invalid token.');
  }

  const user = store.getUserById(payload.sub);
  if (!user) {
    throw new UnauthorizedError('User no longer exists.');
  }

  req.user = user;
  logger.debug('auth:ok', { userId: user.id, role: user.role, requestId: req.requestId });
  next();
}

// ── Middleware: role-based access control 

const ROLE_HIERARCHY: Record<UserRole, number> = {
  viewer:  1,
  analyst: 2,
  admin:   3,
};

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new UnauthorizedError();
    const minRequired = Math.min(...roles.map(r => ROLE_HIERARCHY[r]));
    if (ROLE_HIERARCHY[req.user.role] < minRequired) {
      throw new ForbiddenError(
        `This action requires one of the following roles: ${roles.join(', ')}.`
      );
    }
    next();
  };
}

// ── Middleware: resource ownership OR admin override

export function requireOwnerOrAdmin(getOwnerId: (req: Request) => string | undefined) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw new UnauthorizedError();
    if (req.user.role === 'admin') return next();
    const ownerId = getOwnerId(req);
    if (ownerId && ownerId !== req.user.id) {
      throw new ForbiddenError('You may only modify resources you own.');
    }
    next();
  };
}
