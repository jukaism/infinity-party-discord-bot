const roleDisplays = {
  Wall: '壁',
  MapTrap: '地図罠',
  S40: '聖域40',
  S50: '聖域50',
}

const roleLimits = [
  ['Wall', 1],
  ['MapTrap', 3],
  ['S40', 4],
  ['S50', 4],
]

const roles = ['MapTrap', 'S50']

const prefix = `希望ロール: ${roleLimits
  .filter((r) => roles.includes(r[0]))
  .map((r) => roleDisplays[r[0]])
  .join()}`
console.warn(prefix)
