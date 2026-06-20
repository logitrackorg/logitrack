import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemePreview } from './ThemePreview';

describe('ThemePreview', () => {
  it('renders 4 sections with default colors', () => {
    render(<ThemePreview />);
    expect(screen.getByText('Navegación')).toBeTruthy();
    expect(screen.getByText('Acción principal')).toBeTruthy();
    expect(screen.getByText('Activo')).toBeTruthy();
  });

  it('shows AA badge for good contrast', () => {
    render(<ThemePreview primaryColor="#2563eb" />);
    // blue on white should get AA
    expect(screen.getByText('✓ AA')).toBeTruthy();
  });

  it('shows FAIL badge for poor contrast', () => {
    render(<ThemePreview sidebarColor="#ffeedd" />);
    // light tan on white text should fail
    const badges = screen.getAllByText('✗');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('uses defaults when color is undefined', () => {
    render(<ThemePreview />);
    // Should render without crashing
    expect(screen.getByText('Navegación')).toBeTruthy();
  });

  it('sidebar uses sidebarColor as background', () => {
    const { container } = render(<ThemePreview sidebarColor="#1e3a5f" />);
    const sidebar = container.querySelector('[data-testid="preview-sidebar"]');
    expect(sidebar).toBeTruthy();
    expect(sidebar).toHaveStyle({ backgroundColor: '#1e3a5f' });
  });

  it('button uses primaryColor as background', () => {
    const { container } = render(<ThemePreview primaryColor="#dc2626" />);
    const button = container.querySelector('[data-testid="preview-button"]');
    expect(button).toBeTruthy();
    expect(button).toHaveStyle({ backgroundColor: '#dc2626' });
  });
});
