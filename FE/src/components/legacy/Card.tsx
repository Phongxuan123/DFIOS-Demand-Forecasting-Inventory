import React from 'react';
import './Card.css';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({ children, className = '', noPadding = false, style, onClick }) => {
  return (
    <div className={`premium-card ${noPadding ? '' : 'p-6'} ${className}`} style={style} onClick={onClick}>
      {children}
    </div>
  );
};
