import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AccessibleInput from '../components/ui/AccessibleInput';

describe('AccessibleInput', () => {
  it('renders with label', () => {
    render(<AccessibleInput label="Email" />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('shows required indicator', () => {
    render(<AccessibleInput label="Name" required />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('shows error message', () => {
    render(<AccessibleInput label="Email" error="Invalid email" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invalid email');
  });

  it('shows helper text', () => {
    render(<AccessibleInput label="Password" helperText="Must be 8 characters" />);
    expect(screen.getByText('Must be 8 characters')).toBeInTheDocument();
  });

  it('connects error to input via aria-describedby', () => {
    render(<AccessibleInput label="Email" error="Invalid" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby');
  });

  it('handles value changes', () => {
    const handleChange = vi.fn();
    render(<AccessibleInput label="Name" onChange={handleChange} />);
    
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'John' } });
    expect(handleChange).toHaveBeenCalled();
  });
});
