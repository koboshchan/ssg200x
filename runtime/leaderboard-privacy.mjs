// Missing settings keep existing players visible across HTTP and socket views.
export const hideFromLeaderboard=member=>member.settings?.hideFromLeaderboard===true;
