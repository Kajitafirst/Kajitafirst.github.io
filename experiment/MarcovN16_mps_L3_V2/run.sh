#!/bin/sh
#PBS -q rt_HF
#PBS -l select=1
#PBS -l walltime=48:00:00
#PBS -P gag51408

cd ${PBS_O_WORKDIR}
cd ../..

source /etc/profile.d/modules.sh
module load python/3.12/3.12.9 cuda/12.6/12.6.1 cudnn/9.5/9.5.1
source qgan_env/bin/activate
python3 main.py -o experiment/MarcovN16_mps_L3_V2

deactivate