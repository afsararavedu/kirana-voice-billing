import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/client';
import '../i18n';
import { ErrorText } from './ErrorText';

describe('ErrorText', () => {
  it('localizes known codes', () => {
    render(<ErrorText error={new ApiError(401, 'INVALID_CREDENTIALS', 'server text')} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Email or password is incorrect');
  });

  it('never shows raw server messages for unknown codes', () => {
    render(<ErrorText error={new ApiError(500, 'INTERNAL', 'stack trace at db.ts:42')} />);
    expect(screen.getByRole('alert')).not.toHaveTextContent('db.ts');
  });
});
