import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Logo } from './logo';

describe('Logo', () => {
  it('loads the brand artwork, not a drawing of its own', () => {
    render(<Logo variant="full" height={96} />);
    const img = screen.getByAltText('SAMCO') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/brand/samco-logo.png');
    expect(img.getAttribute('height')).toBe('96');
  });

  it('uses the compact mark where space is tight', () => {
    render(<Logo variant="mark" />);
    expect(screen.getByAltText('SAMCO').getAttribute('src')).toBe('/brand/samco-mark.png');
  });

  /**
   * The case that actually shipped broken.
   *
   * These pages are server-rendered, so on a full page load the browser starts
   * fetching the image before React hydrates. A missing asset errors in that
   * gap, `onError` is attached too late to hear it, and the browser's
   * broken-image icon stays on screen. Simulating it means presenting an image
   * that is already `complete` with no natural width — a finished, failed load
   * — at the moment the ref is attached.
   */
  it('falls back when the asset already failed before React was listening', () => {
    const complete = vi
      .spyOn(HTMLImageElement.prototype, 'complete', 'get')
      .mockReturnValue(true);
    const naturalWidth = vi
      .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
      .mockReturnValue(0);

    try {
      render(<Logo variant="full" />);
      expect(screen.queryByAltText('SAMCO')).toBeNull();
      expect(screen.getByText('SAMCO')).toBeTruthy();
      expect(screen.getByText('Restaurant | Banquets')).toBeTruthy();
    } finally {
      complete.mockRestore();
      naturalWidth.mockRestore();
    }
  });

  it('keeps the image when it loaded before React was listening', () => {
    const complete = vi
      .spyOn(HTMLImageElement.prototype, 'complete', 'get')
      .mockReturnValue(true);
    const naturalWidth = vi
      .spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get')
      .mockReturnValue(512);

    try {
      render(<Logo variant="mark" />);
      // A real, decoded image must NOT be swapped for the fallback.
      expect(screen.getByAltText('SAMCO')).toBeTruthy();
    } finally {
      complete.mockRestore();
      naturalWidth.mockRestore();
    }
  });

  // A failure AFTER hydration still has to be caught by onError.
  it('falls back to a legible wordmark when the asset is missing', () => {
    render(<Logo variant="full" />);
    fireEvent.error(screen.getByAltText('SAMCO'));

    expect(screen.queryByAltText('SAMCO')).toBeNull();
    expect(screen.getByText('SAMCO')).toBeTruthy();
    expect(screen.getByText('Restaurant | Banquets')).toBeTruthy();
  });

  it('the compact fallback carries the name only', () => {
    render(<Logo variant="mark" />);
    fireEvent.error(screen.getByAltText('SAMCO'));

    expect(screen.getByText('SAMCO')).toBeTruthy();
    expect(screen.queryByText('Restaurant | Banquets')).toBeNull();
  });

  // Beside a visible "SAMCO" the logo is decoration; announcing it too would
  // make a screen reader say the company name twice.
  it('is hidden from assistive tech when marked decorative', () => {
    const { container } = render(<Logo decorative />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('alt')).toBe('');
    expect(img?.getAttribute('aria-hidden')).toBe('true');
  });

  it('names the company for assistive tech when it stands alone', () => {
    const { container } = render(<Logo />);
    expect(container.querySelector('img')?.getAttribute('aria-hidden')).toBeNull();
  });
});
