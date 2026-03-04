import React, { useEffect } from 'react';
import { CheckIcon } from './Icons';

function Modal({ isOpen, onClose, title, message }) {
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') onClose();
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div 
      className={`modal ${isOpen ? 'active' : ''}`}
      onClick={handleBackdropClick}
    >
      <div className="modal-content">
        <CheckIcon />
        <h3>{title}</h3>
        <p>{message}</p>
        <button className="modal-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

export default Modal;
