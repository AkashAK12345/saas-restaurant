import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateHallDto, CreatePackageDto, UpdateHallDto } from './banquet.dto.js';

/**
 * A hall named "   " was once accepted — the screens trim, the API did not —
 * and then listed as a blank row in every hall picker.
 */
async function errorsFor<T extends object>(cls: new () => T, body: object): Promise<string[]> {
  const dto = plainToInstance(cls, body);
  return (await validate(dto)).map((e) => e.property);
}

describe('banquet names', () => {
  it('refuses a hall name made only of spaces', async () => {
    expect(await errorsFor(CreateHallDto, { name: '   ', capacity: 10 })).toContain('name');
    expect(await errorsFor(UpdateHallDto, { name: '   ' })).toContain('name');
  });

  it('refuses a package name made only of spaces', async () => {
    expect(
      await errorsFor(CreatePackageDto, { name: '  ', price_per_guest_minor: 100, currency: 'INR', items: [] }),
    ).toContain('name');
  });

  it('stores a real name without the surrounding spaces', async () => {
    const dto = plainToInstance(CreateHallDto, { name: '  Terrace  ', capacity: 80 });
    expect(await validate(dto)).toEqual([]);
    expect(dto.name).toBe('Terrace');
  });
});
