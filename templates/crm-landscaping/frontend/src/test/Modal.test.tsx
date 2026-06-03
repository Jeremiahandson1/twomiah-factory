import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AccessibleModal, ConfirmDialog } from '../components/ui/AccessibleModal';

describe('AccessibleModal', () => {
  it('renders when open', () => {
    render(
      <AccessibleModal isOpen={true} onClose={() => {}} title="Test Modal">
        <p>Modal content</p>
      </AccessibleModal>
    );
    
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    expect(screen.getByText('Modal content')).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(
      <AccessibleModal isOpen={false} onClose={() => {}} title="Hidden Modal">
        <p>Content</p>
      </AccessibleModal>
    );
    
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn();
    render(
      <AccessibleModal isOpen={true} onClose={onClose} title="Modal">
        Content
      </AccessibleModal>
    );
    
    fireEvent.click(screen.getByLabelText('Close modal'));
    expect(onClose).toHaveBeenCalled();
  });

  it('has correct aria attributes', () => {
    render(
      <AccessibleModal isOpen={true} onClose={() => {}} title="Accessible" description="A test modal">
        Content
      </AccessibleModal>
    );
    
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
  });
});

describe('ConfirmDialog', () => {
  it('renders confirmation message', () => {
    render(
      <ConfirmDialog
        isOpen={true}
        onClose={() => {}}
        onConfirm={() => {}}
        title="Delete Item"
        message="Are you sure?"
      />
    );
    
    expect(screen.getByText('Delete Item')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        isOpen={true}
        onClose={() => {}}
        onConfirm={onConfirm}
        confirmText="Delete"
        message="Confirm?"
      />
    );
    
    fireEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('calls onClose when cancel button clicked', () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        isOpen={true}
        onClose={onClose}
        onConfirm={() => {}}
        cancelText="Never mind"
        message="Confirm?"
      />
    );
    
    fireEvent.click(screen.getByText('Never mind'));
    expect(onClose).toHaveBeenCalled();
  });
});
