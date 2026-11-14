import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useT } from '../../i18n/index.tsx';
import { Input, type InputProps } from '../../components/ui/forms.tsx';

/** Password input with show/hide and a Caps Lock warning. */
export const PasswordField: React.FC<Omit<InputProps, 'type' | 'trailing'>> = ({ hint, onKeyDown, onKeyUp, ...rest }) => {
  const t = useT();
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const track = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState('CapsLock'));
  return (
    <Input
      {...rest}
      type={shown ? 'text' : 'password'}
      hint={caps ? t('common.form.caps_lock') : hint}
      onKeyDown={(e) => {
        track(e);
        onKeyDown?.(e);
      }}
      onKeyUp={(e) => {
        track(e);
        onKeyUp?.(e);
      }}
      trailing={
        <button
          type="button"
          className="ui-control__addon"
          onClick={() => setShown((s) => !s)}
          aria-label={t(shown ? 'common.form.hide_password' : 'common.form.show_password')}
          aria-pressed={shown}
        >
          {shown ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      }
    />
  );
};
