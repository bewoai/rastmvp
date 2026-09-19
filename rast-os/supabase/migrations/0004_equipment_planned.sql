-- Bütçelenmiş fakat henüz satın alınmamış ekipmanlar.
alter type equipment_status add value if not exists 'planned' before 'idle';
