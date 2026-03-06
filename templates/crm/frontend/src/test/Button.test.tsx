import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AccessibleButton from '../components/ui/AccessibleButton';

describe('AccessibleButton', () => {
  it('renders with children', () => {
    render(<AccessibleButton>Click me</AccessibleButton>);
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument();
  });

  it('calls onClick handler', () => {
    const handleClick = vi.fn();
    render(<AccessibleButton onClick={handleClick}>Click</AccessibleButton>);
    
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('disables button when disabled prop is true', () => {
    render(<AccessibleButton disabled>Disabled</AccessibleButton>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('shows loading state', () => {
    render(<AccessibleButton loading>Loading</AccessibleButton>);
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });

  it('applies variant classes', () => {
    const { container } = render(<AccessibleButton variant="danger">Delete</AccessibleButton>);
    expect(container.querySelector('button')).toHaveClass('bg-red-500');
  });

  it('supports aria-label', () => {
    render(<AccessibleButton aria-label="Close dialog">X</AccessibleButton>);
    expect(screen.getByRole('button', { name: /close dialog/i })).toBeInTheDocument();
  });
});
