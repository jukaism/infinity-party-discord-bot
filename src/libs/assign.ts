export type Assignment = [string, number[]]
export type TaskAndLimit = [string, number]

// 好みに応じて業務をソートする関数
function sortByPreference(preferences, taskAndLimits) {
  const tasks = taskAndLimits.map((t) => t[0])
  // 好みを配列に詰め替える
  const preferenceArray = preferences.map((p, i) => [i, p])

  // 好みを優先度に変換する
  const priorityArray = tasks.map((t) => {
    const priority = preferenceArray
      .filter((p) => p[1].includes(t))
      .map((p) => p[0])
    return [t, priority]
  })

  // 決定的 > 人気低 > 人気高
  const sortedTasks = priorityArray.sort((a, b) => {
    const targetA = taskAndLimits.find((tal) => tal[0] === a[0])
    const limitA = targetA?.[1] || 0
    const requestA = a[1].length
    const targetB = taskAndLimits.find((tal) => tal[0] === a[0])
    const limitB = targetB?.[1] || 0
    const requestB = b[1].length
    let aPriority = -requestA
    let bPriority = -requestB

    const decisiveA = 0 < requestA && requestA <= limitA
    const decisiveB = 0 < requestB && requestB <= limitB

    aPriority += decisiveA ? 100 : 0
    bPriority += decisiveB ? 100 : 0
    aPriority += requestA === 0 ? -1000 : 0
    bPriority += requestB === 0 ? -1000 : 0
    return bPriority - aPriority
  })
  // ソート後の業務を返す
  return sortedTasks.map((t) => t[0])
}

// 好みに基づいて業務を割り当てる関数
export const assignTasks = (
  userWithLikes: string[][],
  taskAndLimits: TaskAndLimit[],
): Assignment[] => {
  // 好みに応じて業務をソートする
  const sortedTasks = sortByPreference(userWithLikes, taskAndLimits)

  // 12人に順番に業務を割り当てる
  const assignment: Assignment[] = []
  const assignedUser: number[] = []
  sortedTasks.forEach((t, tInd) => {
    assignment.push([t, []])
    const targetTask = taskAndLimits.find((tal) => tal[0] === t)
    const limit = targetTask?.[1] || 0
    userWithLikes.forEach((u, ind) => {
      const insufficient = limit > assignment[tInd][1].length
      if (insufficient && u.includes(t) && !assignedUser.includes(ind)) {
        assignedUser.push(ind)
        assignment[tInd][1].push(ind)
      }
    })
  })
  sortedTasks.forEach((t, tInd) => {
    const targetTask = taskAndLimits.find((tal) => tal[0] === t)
    const limit = targetTask?.[1] || 0
    userWithLikes
      .slice()
      .reverse()
      .forEach((_u, revind) => {
        const ind = userWithLikes.length - 1 - revind
        const insufficient = limit > assignment[tInd][1].length
        if (insufficient && !assignedUser.includes(ind)) {
          assignedUser.push(ind)
          assignment[tInd][1].push(ind)
        }
      })
  })
  const sortedAssignment: Assignment[] = taskAndLimits.map(
    (tAnda): Assignment =>
      assignment.find((a) => a[0] === tAnda[0]) || [tAnda[0], []],
  )

  // 割り当て結果を返す
  return sortedAssignment
}
