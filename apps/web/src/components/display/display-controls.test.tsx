import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DisplayControls, readDensity } from './display-controls';

describe('DisplayControls', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    delete (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen;
  });

  it('switches to compact density and remembers it on this screen', () => {
    const onChange = vi.fn();
    render(<DisplayControls density="comfortable" onDensityChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
    expect(onChange).toHaveBeenCalledWith('compact');
    expect(readDensity()).toBe('compact');
  });

  it('switches back to larger text', () => {
    const onChange = vi.fn();
    render(<DisplayControls density="compact" onDensityChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Larger text' }));
    expect(onChange).toHaveBeenCalledWith('comfortable');
    expect(readDensity()).toBe('comfortable');
  });

  it('offers full screen where the browser supports it', async () => {
    const request = vi.fn().mockResolvedValue(undefined);
    (document.documentElement as { requestFullscreen?: unknown }).requestFullscreen = request;
    render(<DisplayControls density="comfortable" onDensityChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Full screen' }));
    await waitFor(() => expect(request).toHaveBeenCalled());
  });

  it('shows no full-screen button where the browser cannot do it', () => {
    render(<DisplayControls density="comfortable" onDensityChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Full screen' })).toBeNull();
  });

  it('contains nothing that changes the queue — presentation only', () => {
    render(<DisplayControls density="comfortable" onDensityChange={vi.fn()} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Compact']);
  });
});
