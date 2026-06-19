import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AccessibleSelect from '../components/ui/AccessibleSelect';

describe('AccessibleSelect', () => {
  const options = [
    { value: 'lead', label: 'Lead' },
    { value: 'client', label: 'Client' },
    { value: 'vendor', label: 'Vendor' },
  ];

  it('renders with label', () => {
    render(<AccessibleSelect label="Contact Type" options={options} />);
    expect(screen.getByLabelText(/contact type/i)).toBeInTheDocument();
  });

  it('renders all options', () => {
    render(<AccessibleSelect label="Type" options={options} />);
    
    expect(screen.getByRole('option', { name: 'Lead' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Client' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Vendor' })).toBeInTheDocument();
  });

  it('shows placeholder', () => {
    render(<AccessibleSelect label="Type" options={options} placeholder="Choose..." />);
    expect(screen.getByRole('option', { name: 'Choose...' })).toBeInTheDocument();
  });

  it('shows required indicator', () => {
    render(<AccessibleSelect label="Type" options={options} required />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('shows error message', () => {
    render(<AccessibleSelect label="Type" options={options} error="Required field" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Required field');
  });

  it('handles selection change', () => {
    const onChange = vi.fn();
    render(<AccessibleSelect label="Type" options={options} onChange={onChange} />);
    
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'client' } });
    expect(onChange).toHaveBeenCalled();
  });

  it('marks invalid when has error', () => {
    render(<AccessibleSelect label="Type" options={options} error="Invalid" />);
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true');
  });
});
