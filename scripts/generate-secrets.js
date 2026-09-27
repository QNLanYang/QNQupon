// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 QNLanYang (全能岚漾)

import { randomBytes } from 'node:crypto';

console.log('APP_ENCRYPTION_KEY=' + randomBytes(32).toString('base64url'));
console.log('SESSION_SECRET=' + randomBytes(32).toString('base64url'));
