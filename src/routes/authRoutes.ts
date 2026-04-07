// src/routes/authRoutes.ts

import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { store } from '../models/store';
import { signToken } from '../middleware/auth';
import { ValidationError, UnauthorizedError } from '../utils/errors';
import { logger } from '../utils/logger';
import { recordAudit } from '../services/auditService';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new ValidationError('Invalid login payload.', parsed.error.errors.map(e => ({
      field: e.path.join('.'),
      code: e.code,
      message: e.message,
    })));
  }

  const { email, password } = parsed.data;
  const user = store.getUserByEmail(email);

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    // Deliberate: do not reveal whether email exists
    throw new UnauthorizedError('Invalid credentials.');
  }

  const token = signToken(user);

  logger.info('auth:login', { userId: user.id, email: user.email, requestId: req.requestId });
  recordAudit('user.login', user, req, user.id, 'user');

  res.json({
    token,
    expiresIn: '8h',
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  });
});

export default router;
