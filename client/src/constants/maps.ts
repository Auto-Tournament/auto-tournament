/**
 * CS2 Map data with images
 */

import type { CS2MapData } from '../types/veto.types';

// Map images - using Steam CDN for better reliability
export const CS2_MAPS: CS2MapData[] = [
  {
    name: 'de_ancient',
    displayName: 'Ancient',
    image: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXQ9QVcJY8gulReQ0HdUuqkw8zTW193Jw1WrurwLBhf2v_WcgJO7c65mrSekMjgMr3dl2gB7ZQo2-3Fod2hiVLi-EM5ZzvwI4OMJRh-Pw-iOBs/',
  },
  {
    name: 'de_anubis',
    displayName: 'Anubis',
    image: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXQ9QVcJY8gulRfQV-rTdq9gMLFSV1_JzRRvrWvI2lh0P3BTjJO4NOlk4mMhfDxYrmDkjMFvJYk0-yS99ml3FC1-hU_Zz3xddfHelM9ZQ7Q_lK7wO7u0ZW-7pzN1zI97Wy9EjyE/',
  },
  {
    name: 'de_dust2',
    displayName: 'Dust II',
    image: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXQ9QVcJY8gulRYQV_bRvCiwMbQVg8kdAoSubaOJQx0wefMdz1N6tW3m4-bhfDxfe7TkjoA7pEl3rqR99Tw3FLh80Btam2gI9SScwFqaVnW-FPqwOvs0Ja-ot2XnuoAOLPr/',
  },
  {
    name: 'de_inferno',
    displayName: 'Inferno',
    image: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXQ9QVcJY8gulReQ0HdQuqkw8zJQEN5JxZzurWsJQN42v_bdgJO48i1ldLVwKOtYOvQwjpU7cAo07nCpNz3ilfg-ko_fSmtc4OVcVVsNQzV8lK8yL3q0Mftot2XnnIlQ-aG/',
  },
  {
    name: 'de_mirage',
    displayName: 'Mirage',
    image: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXQ9QVcJY8gulRYSl7dFNOm3p3HS0hwIRNTuYOrLR02eKTJdQJD7cynwdPSwPOiYu-JxT5SuJwniOjE896m2lKw_0M9Z2qhd47AJw47YFzO11nsx-fxxcjryOC2Ew/',
  },
  {
    name: 'de_nuke',
    displayName: 'Nuke',
    image: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXQ9QVcJY8gulRPQVraFd2kw8zQQFhwIB5XrbiOJQJz2v_YfTpD48y_wdDQwaPwYujQlz5Q7pMhibiV9I2l2w23r0U4amqhJtWQcVRrNQ7X-1G7xrnr15bou53MnyY1viIqt37YyRXghlwaHYMZqA/',
  },
  {
    name: 'de_vertigo',
    displayName: 'Vertigo',
    image: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXQ9QVcJY8gulReQ0DdS-C7leHTDREhOxRSuKi0Nglp2fzbJDgNueOxwdHdzvT1J--CxWgEvZAh2OjF9o-l0FLk-hA5MW2iLdOXegBsNVvSrlDtl-_pgpe_vZnKmyFm7yAm7XvVnRC11BwabLQ50uveFwtPQfUfTmQCPd0/',
  },
];

export const getMapData = (mapName: string): CS2MapData | undefined => {
  return CS2_MAPS.find((m) => m.name === mapName);
};

export const getMapDisplayName = (mapName: string): string => {
  const mapData = getMapData(mapName);
  return mapData?.displayName || mapName.replace('de_', '');
};

