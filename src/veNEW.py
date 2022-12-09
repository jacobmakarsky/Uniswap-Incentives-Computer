import numpy as np
import matplotlib.pyplot as plt

#points = np.array([(1, 1), (4, 1.3), (8, 1.95), (12, 3.3)])
#points = np.array([(3, 1), (12, 1.3), (24, 1.95), (36, 3.3)])
points = np.array([(90, 1), (365, 1.3), (730, 1.95), (1095, 3.3)])


# get x and y vectors
x = points[:,0]
y = points[:,1]

# calculate polynomial
z = np.polyfit(x, y, 3)
f = np.poly1d(z)

# calculate new x's and y's
x_new = np.linspace(x[0], x[-1], 50)
y_new = f(x_new)
print("z")
print(z)
print("f")
print(f)


print("sampling for reasons..")
#3m 1y 1.5y 2y 2.5y 3y
x_che = np.array([90,365,548,730,913,1095])
y_che = f(x_che)
print("points for che")
print(y_che)

plt.title("veNEWO LFG!!!")
plt.xlabel("lock time (days)")
plt.ylabel("boost (multipler for boomers)")
plt.plot(x,y,'o', x_new, y_new)
plt.xlim([x[0]-1, x[-1] + 1 ])
plt.show()

x_days = [90+i for i in range(1006)]
y_days = f(x_days)
print(x_days)
print(y_days)

a_file = open("veMult_90-1095.txt", "w")
np.savetxt(a_file, y_days, fmt='%1.3f')
a_file.close()

weekly = y_days[::7]
b_file = open("veMult_weekly.txt", "w")
np.savetxt(b_file, weekly, fmt='%1.3f')
b_file.close()
