import { faker } from '@faker-js/faker';

export type PlayerProfile = {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  displayName?: string;
};

export function generatePlayerProfile(locale: string = 'en'): PlayerProfile {
  // If you want locale control, set it here. If your project uses faker instances, adapt accordingly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (faker as any).locale = locale as any;

  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();

  return {
    id: faker.string.uuid(),
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`,
  };
}


